import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { config } from '../../config.js';
import { registerBackend, type AgentBackend } from '../backend.js';
import { buildEnvironment } from '../environment.js';
import type { AgentSessionOptions, AgentStreamEvent } from '../session.js';
import { toolsForMode } from '../tools.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function formatToolSummary(name: string, input: unknown): string {
  const serialized = input === undefined ? '' : ` ${safeJson(input).slice(0, 600)}`;
  return `running ${name}${serialized}`;
}

function extractContentEvents(content: unknown): AgentStreamEvent[] {
  if (!Array.isArray(content)) return [];

  const events: AgentStreamEvent[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;

    const blockType = asString(block.type);
    if (blockType === 'text') {
      const text = asString(block.text);
      if (text) {
        events.push({ type: 'text', delta: text });
      }
      continue;
    }

    if (blockType === 'tool_use') {
      const name = asString(block.name) ?? 'tool';
      events.push({ type: 'tool', summary: formatToolSummary(name, block.input) });
    }
  }

  return events;
}

function extractDeltaEvents(delta: unknown): AgentStreamEvent[] {
  if (!isRecord(delta)) return [];

  if (asString(delta.type) === 'text_delta') {
    const text = asString(delta.text);
    if (text) return [{ type: 'text', delta: text }];
  }

  const directText = asString(delta.text);
  if (directText) return [{ type: 'text', delta: directText }];

  return [];
}

function extractStreamEvent(payload: Record<string, unknown>): AgentStreamEvent[] {
  const event = payload.event;
  if (!isRecord(event)) return [];

  const eventType = asString(event.type);
  if (eventType === 'content_block_delta') {
    return extractDeltaEvents(event.delta);
  }

  if (eventType === 'content_block_start') {
    const contentBlock = event.content_block;
    if (!isRecord(contentBlock) || asString(contentBlock.type) !== 'tool_use') return [];
    const name = asString(contentBlock.name) ?? 'tool';
    return [{ type: 'tool', summary: formatToolSummary(name, contentBlock.input) }];
  }

  return [];
}

function extractSessionLifecycleEvents(
  payload: Record<string, unknown>,
  messageType: string,
): AgentStreamEvent[] {
  if (messageType === 'result' || messageType === 'error') {
    return [];
  }

  const sessionId = asString(payload.session_id);
  if (!sessionId) {
    return [];
  }

  return [{ type: 'session', sessionId, status: 'confirmed' }];
}

function isAuthoritativeClaudeResumeFailure(error: string): boolean {
  return [
    /resume session not found/i,
    /invalid session/i,
    /session .*invalid/i,
    /unknown session/i,
    /cannot resume/i,
    /not resumable/i,
  ].some(pattern => pattern.test(error));
}

export function extractEvents(
  payload: unknown,
  options: { resumeSessionId?: string } = {},
): AgentStreamEvent[] {
  if (!isRecord(payload)) return [];
  const messageType = asString(payload.type);
  if (!messageType) return [];

  const sessionEvents = extractSessionLifecycleEvents(payload, messageType);

  if (messageType === 'stream_event') {
    return [...sessionEvents, ...extractStreamEvent(payload)];
  }

  if (messageType === 'assistant') {
    const deltaEvents = extractDeltaEvents(payload.delta);
    if (deltaEvents.length > 0) {
      return [...sessionEvents, ...deltaEvents];
    }

    const message = payload.message;
    if (!isRecord(message)) return [];
    return [...sessionEvents, ...extractContentEvents(message.content)];
  }

  if (messageType === 'tool_use_summary') {
    const summary = asString(payload.summary);
    return summary ? [...sessionEvents, { type: 'tool', summary }] : sessionEvents;
  }

  if (messageType === 'system') {
    const status = asString(payload.status) ?? asString(payload.subtype);
    return status ? [...sessionEvents, { type: 'status', status }] : sessionEvents;
  }

  if (messageType === 'result') {
    const result = asString(payload.result) ?? '';
    const sessionId = asString(payload.session_id);
    return [{ type: 'done', result, sessionId }];
  }

  if (messageType === 'error') {
    const error = asString(payload.error) ?? asString(payload.message) ?? 'Claude CLI request failed';
    return options.resumeSessionId && isAuthoritativeClaudeResumeFailure(error)
      ? [
          {
            type: 'session-invalidated',
            sessionId: options.resumeSessionId,
            reason: error,
          },
          { type: 'error', error },
        ]
      : [{ type: 'error', error }];
  }

  return [];
}

export function createClaudeArgs(options: AgentSessionOptions): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];

  const model = options.model ?? config.claudeModel;
  if (model) {
    args.push('--model', model);
  }

  if (options.effort) {
    args.push('--effort', options.effort);
  }

  args.push(...toolsForMode(options.mode));

  if (options.resumeSessionId) {
    args.push('--resume', options.resumeSessionId);
  } else if (options.sessionId) {
    args.push('--session-id', options.sessionId);
  }

  args.push(options.prompt);
  return args;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function* streamClaude(options: AgentSessionOptions): AsyncGenerator<AgentStreamEvent, void> {
  const cwd = options.cwd ?? config.claudeCwd;
  yield {
    type: 'environment',
    environment: buildEnvironment(
      'claude',
      options,
      cwd,
      options.cwd ? 'explicit' : 'default',
      options.model ?? config.claudeModel,
    ),
  };

  const child = spawn(config.claudeBin, createClaudeArgs(options), {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closePromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const stderrLines: string[] = [];
  let abortReason: 'timeout' | 'aborted' | null = null;

  const timeout = setTimeout(() => {
    abortReason = 'timeout';
    child.kill('SIGTERM');
  }, config.agentTimeoutMs);

  const onAbort = () => {
    abortReason = 'aborted';
    child.kill('SIGTERM');
  };

  if (options.abortSignal) {
    options.abortSignal.addEventListener('abort', onAbort);
    if (options.abortSignal.aborted) {
      onAbort();
    }
  }

  const stderrReader = child.stderr ? readline.createInterface({ input: child.stderr }) : null;
  stderrReader?.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed) {
      stderrLines.push(trimmed);
    }
  });

  const stdoutReader = child.stdout ? readline.createInterface({ input: child.stdout }) : null;

  try {
    if (!stdoutReader) {
      throw new Error('Claude CLI stdout is unavailable');
    }

    for await (const rawLine of stdoutReader) {
      const line = rawLine.trim();
      if (!line) continue;

      let payload: unknown;
      try {
        payload = JSON.parse(line);
      } catch {
        yield { type: 'status', status: line };
        continue;
      }

      const events = extractEvents(payload, { resumeSessionId: options.resumeSessionId });
      for (const event of events) {
        yield event;
      }
    }

    const { code, signal } = await closePromise;
    if (abortReason === 'timeout') {
      yield { type: 'error', error: 'Agent request timed out' };
      return;
    }

    if (abortReason === 'aborted') {
      yield { type: 'error', error: 'Agent request aborted' };
      return;
    }

    if (code !== 0) {
      const details = stderrLines.join('\n').trim();
      const fallback = signal
        ? `Claude CLI exited with signal ${signal}`
        : `Claude CLI exited with code ${String(code)}`;
      yield { type: 'error', error: details || fallback };
    }
  } catch (error) {
    if (abortReason === 'timeout') {
      yield { type: 'error', error: 'Agent request timed out' };
    } else if (abortReason === 'aborted') {
      yield { type: 'error', error: 'Agent request aborted' };
    } else {
      const details = stderrLines.join('\n').trim();
      yield { type: 'error', error: details || toErrorMessage(error) };
    }
  } finally {
    clearTimeout(timeout);
    stderrReader?.close();
    stdoutReader?.close();
    if (!child.killed) {
      child.kill('SIGTERM');
    }
    if (options.abortSignal) {
      options.abortSignal.removeEventListener('abort', onAbort);
    }
  }
}

export const claudeBackend: AgentBackend = {
  name: 'claude',
  stream: streamClaude,
};

registerBackend(claudeBackend);
