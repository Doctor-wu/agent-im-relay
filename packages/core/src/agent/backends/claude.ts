import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { config } from '../../config';
import {
  isBackendCommandAvailable,
  registerBackend,
  type AgentBackend,
  type BackendModel,
} from '../backend';
import { buildEnvironment } from '../environment';
import type { AgentSessionOptions, AgentStreamEvent } from '../session';
import { toolsForMode, type PermissionMode } from '../tools';

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

type ExtractedPermissionRequest = {
  requestId: string;
  tool?: string;
  reason?: string;
};

function formatClaudePermissionReason(toolInput: unknown): string | undefined {
  if (!isRecord(toolInput)) {
    return toolInput === undefined ? undefined : safeJson(toolInput);
  }

  const command = asString(toolInput.command);
  if (command) {
    return command;
  }

  return safeJson(toolInput);
}

function findControlPermissionRequest(record: Record<string, unknown>): ExtractedPermissionRequest | undefined {
  const requestId = asString(record.request_id) ?? asString(record.requestId) ?? asString(record.id);
  if (!requestId) {
    return undefined;
  }

  const request = isRecord(record.request) ? record.request : undefined;
  if (!request || asString(request.subtype) !== 'can_use_tool') {
    return undefined;
  }

  return {
    requestId,
    tool: asString(request.tool_name) ?? asString(request.toolName) ?? asString(request.name),
    reason: formatClaudePermissionReason(request.input),
  };
}

function formatClaudeUserMessage(text: string): string {
  return `${JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
    },
  })}\n`;
}

export function extractClaudePermissionRequest(payload: unknown): ExtractedPermissionRequest | undefined {
  if (!isRecord(payload)) return undefined;

  if (asString(payload.type) === 'control_request') {
    return findControlPermissionRequest(payload);
  }

  return undefined;
}

export function formatClaudePermissionDecision(
  requestId: string,
  decision: 'approved' | 'denied',
): string {
  return `${JSON.stringify({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: decision === 'approved'
        ? { behavior: 'allow' }
        : { behavior: 'deny', message: 'User denied' },
    },
  })}\n`;
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

export function createClaudeArgs(
  options: AgentSessionOptions,
  permissionMode: PermissionMode = config.permissionMode,
): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];

  if (permissionMode === 'safe') {
    args.push('--input-format', 'stream-json');
  }

  if (options.model) {
    args.push('--model', options.model);
  }

  if (options.effort) {
    args.push('--effort', options.effort);
  }

  args.push(...toolsForMode(options.mode, permissionMode));

  if (options.resumeSessionId) {
    args.push('--resume', options.resumeSessionId);
  } else if (options.sessionId) {
    args.push('--session-id', options.sessionId);
  }

  if (permissionMode !== 'safe') {
    args.push(options.prompt);
  }
  return args;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function readClaudeConfiguredModels(path: string): BackendModel[] {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { model?: string };
    return typeof raw.model === 'string'
      ? [{ id: raw.model, label: raw.model }]
      : [];
  } catch {
    return [];
  }
}

function getSupportedClaudeModels(): BackendModel[] {
  const aliases = ['sonnet', 'opus', 'haiku', 'sonnet1m'].map(model => ({
    id: model,
    label: model,
  }));
  const base = join(homedir(), '.claude');

  return [
    ...aliases,
    ...readClaudeConfiguredModels(join(base, 'settings.json')),
    ...readClaudeConfiguredModels(join(base, 'settings copy.json')),
  ];
}

async function* streamClaude(options: AgentSessionOptions): AsyncGenerator<AgentStreamEvent, void> {
  const cwd = options.cwd ?? config.claudeCwd;
  const permissionMode = config.permissionMode;
  yield {
    type: 'environment',
    environment: buildEnvironment(
      'claude',
      options,
      cwd,
      options.cwd ? 'explicit' : 'default',
      options.model,
    ),
  };

  const child = spawn(config.claudeBin, createClaudeArgs(options, permissionMode), {
    cwd,
    env: process.env,
    stdio: permissionMode === 'safe' ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
  });
  if (permissionMode === 'safe') {
    child.stdin?.write(formatClaudeUserMessage(options.prompt));
  }
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

    let registerPermissionRequest:
      | ((options: {
        conversationId: string;
        requestId: string | number;
        backend: string;
        tool?: string;
        reason?: string;
        timeoutMs: number;
      }) => {
        requestId: string | number;
        backend: string;
        tool?: string;
        reason?: string;
        expiresAt: string;
      })
      | undefined;

    if (permissionMode === 'safe' && options.conversationId && child.stdin) {
      const {
        registerConversationPermissionResponder,
        registerPermissionRequest: registerPermissionRequestWithRuntime,
      } = await import('../runtime');

      registerConversationPermissionResponder(options.conversationId, {
        backend: 'claude',
        respond(requestId, decision) {
          child.stdin?.write(formatClaudePermissionDecision(String(requestId), decision));
        },
      });
      registerPermissionRequest = registerPermissionRequestWithRuntime;
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

      if (registerPermissionRequest && options.conversationId) {
        const permissionRequest = extractClaudePermissionRequest(payload);
        if (permissionRequest) {
          const request = registerPermissionRequest({
            conversationId: options.conversationId,
            requestId: permissionRequest.requestId,
            backend: 'claude',
            tool: permissionRequest.tool,
            reason: permissionRequest.reason,
            timeoutMs: config.permissionRequestTimeoutMs,
          });
          yield {
            type: 'permission-requested',
            requestId: request.requestId,
            backend: request.backend,
            tool: request.tool,
            reason: request.reason,
            expiresAt: request.expiresAt,
          };
          continue;
        }
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
  isAvailable: () => isBackendCommandAvailable(config.claudeBin),
  listModels: getSupportedClaudeModels,
  stream: streamClaude,
};

registerBackend(claudeBackend);
