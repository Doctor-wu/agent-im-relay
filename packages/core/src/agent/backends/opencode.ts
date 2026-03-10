import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { config } from '../../config.js';
import {
  isBackendCommandAvailable,
  registerBackend,
  type AgentBackend,
} from '../backend.js';
import { buildEnvironment } from '../environment.js';
import type { AgentSessionOptions, AgentStreamEvent } from '../session.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function extractErrorMessage(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    return value.message;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  return extractErrorMessage(value.message)
    ?? extractErrorMessage(value.error)
    ?? safeJson(value);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function formatToolSummary(name: string, input: unknown): string {
  const label = name === 'bash' ? 'Bash' : name;
  const serialized = input === undefined ? '' : ` ${safeJson(input).slice(0, 600)}`;
  return `running ${label}${serialized}`;
}

function extractOpencodeSessionId(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  return asString(payload.sessionID);
}

function isAuthoritativeOpencodeResumeFailure(error: string): boolean {
  return [
    /resume session not found/i,
    /invalid session/i,
    /session .*invalid/i,
    /unknown session/i,
    /cannot resume/i,
    /not resumable/i,
  ].some(pattern => pattern.test(error));
}

export function createOpencodeArgs(options: AgentSessionOptions): string[] {
  const args = ['run', '--format', 'json'];

  if (options.effort) {
    args.push('--variant', options.effort);
  }

  if (options.resumeSessionId) {
    args.push('--session', options.resumeSessionId);
  }

  args.push(options.prompt);
  return args;
}

export function extractOpencodeEvents(
  payload: unknown,
  options: { resumeSessionId?: string } = {},
): AgentStreamEvent[] {
  if (!isRecord(payload)) return [];

  const type = asString(payload.type);
  if (!type) return [];

  if (type === 'step_start') {
    const sessionId = extractOpencodeSessionId(payload);
    return sessionId
      ? [{
          type: 'session',
          sessionId,
          status: options.resumeSessionId ? 'resumed' : 'confirmed',
        }]
      : [];
  }

  if (type === 'tool_use') {
    const part = payload.part;
    if (!isRecord(part)) return [];

    const tool = asString(part.tool) ?? 'tool';
    const state = isRecord(part.state) ? part.state : undefined;
    const input = isRecord(state?.input) ? state.input : undefined;
    const command = asString(input?.command);
    return [{ type: 'tool', summary: formatToolSummary(tool, command ? { command } : input) }];
  }

  if (type === 'text') {
    const part = payload.part;
    if (!isRecord(part)) return [];

    const text = asString(part.text);
    return text ? [{ type: 'text', delta: text }] : [];
  }

  if (type === 'error') {
    const error = extractErrorMessage(payload.error)
      ?? extractErrorMessage(payload.message)
      ?? 'OpenCode CLI request failed';
    return options.resumeSessionId && isAuthoritativeOpencodeResumeFailure(error)
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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function* streamOpencode(options: AgentSessionOptions): AsyncGenerator<AgentStreamEvent, void> {
  const cwd = options.cwd ?? config.claudeCwd;
  yield {
    type: 'environment',
    environment: buildEnvironment(
      'opencode',
      options,
      cwd,
      options.cwd ? 'explicit' : 'default',
    ),
  };

  const child = spawn(config.opencodeBin, createOpencodeArgs(options), {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const closePromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    },
  );

  const stderrLines: string[] = [];
  let abortReason: 'timeout' | 'aborted' | null = null;
  let sessionId = options.resumeSessionId;
  let fullOutput = '';
  let sawErrorEvent = false;

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
    if (line.trim()) stderrLines.push(line.trim());
  });

  const stdoutReader = child.stdout ? readline.createInterface({ input: child.stdout }) : null;

  try {
    if (!stdoutReader) {
      throw new Error('OpenCode CLI stdout is unavailable');
    }

    for await (const rawLine of stdoutReader) {
      const line = rawLine.trimEnd();
      if (!line) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      sessionId = extractOpencodeSessionId(parsed) ?? sessionId;

      for (const event of extractOpencodeEvents(parsed, { resumeSessionId: options.resumeSessionId })) {
        if (event.type === 'text') {
          fullOutput += event.delta;
        }
        if (event.type === 'error') {
          sawErrorEvent = true;
        }
        yield event;
      }
    }

    const { code, signal } = await closePromise;
    const details = stderrLines.join('\n').trim();

    if (abortReason === 'timeout') {
      yield { type: 'error', error: 'Agent request timed out' };
      return;
    }

    if (abortReason === 'aborted') {
      yield { type: 'error', error: 'Agent request aborted' };
      return;
    }

    if (code !== 0) {
      const fallback = signal
        ? `OpenCode CLI exited with signal ${signal}`
        : `OpenCode CLI exited with code ${String(code)}`;
      if (!sawErrorEvent) {
        yield { type: 'error', error: details || fallback };
      }
      return;
    }

    if (details && !sawErrorEvent && !fullOutput.trim()) {
      yield { type: 'error', error: details };
      return;
    }

    if (sawErrorEvent) {
      return;
    }

    yield { type: 'done', result: fullOutput.trim(), sessionId };
  } catch (error) {
    if (abortReason === 'timeout') {
      yield { type: 'error', error: 'Agent request timed out' };
      return;
    }

    if (abortReason === 'aborted') {
      yield { type: 'error', error: 'Agent request aborted' };
      return;
    }

    const details = stderrLines.join('\n').trim();
    yield { type: 'error', error: details || toErrorMessage(error) };
  } finally {
    clearTimeout(timeout);
    stderrReader?.close();
    stdoutReader?.close();
    if (!child.killed) child.kill('SIGTERM');
    if (options.abortSignal) {
      options.abortSignal.removeEventListener('abort', onAbort);
    }
  }
}

export const opencodeBackend: AgentBackend = {
  name: 'opencode',
  isAvailable: () => isBackendCommandAvailable(config.opencodeBin),
  stream: streamOpencode,
};

registerBackend(opencodeBackend);
