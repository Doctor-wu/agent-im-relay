import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { config } from '../../config';
import {
  isBackendCommandAvailable,
  registerBackend,
  type AgentBackend,
  type BackendModel,
} from '../backend';
import { buildEnvironment } from '../environment';
import type { AgentSessionOptions, AgentStreamEvent } from '../session';
import type { PermissionMode } from '../tools';

const WORKING_DIR_PATTERN = /^Working directory:\s*(.+)$/;
const LOG_LINE_PATTERN = /^\d{4}-\d{2}-\d{2}T/;
const CODEX_CLIENT_NAME = 'agent-im-relay';
const CODEX_CLIENT_VERSION = '1.1.1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asStringOrNumber(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function formatCommandSummary(command: string): string {
  return `running Bash ${safeJson({ command }).slice(0, 600)}`;
}

function writeCodexPrompt(
  stdin: NodeJS.WritableStream | null | undefined,
  prompt: string,
  keepOpen: boolean,
): void {
  if (!stdin) {
    return;
  }

  if (keepOpen) {
    stdin.write(prompt);
    if (!prompt.endsWith('\n')) {
      stdin.write('\n');
    }
    return;
  }

  stdin.end(prompt);
}

type ExtractedPermissionRequest = {
  requestId: string | number;
  tool?: string;
  reason?: string;
};

type JsonRpcId = number | string;
type JsonRpcMessage = Record<string, unknown>;

function extractCodexSessionId(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;

  const method = asString(payload.method);
  if (method === 'thread/started') {
    const params = isRecord(payload.params) ? payload.params : undefined;
    const thread = params && isRecord(params.thread) ? params.thread : undefined;
    return thread ? asString(thread.id) : undefined;
  }

  const result = isRecord(payload.result) ? payload.result : undefined;
  const thread = result && isRecord(result.thread) ? result.thread : undefined;
  if (thread) {
    return asString(thread.id);
  }

  const type = asString(payload.type);
  if (type === 'thread.started' || type === 'thread.resumed') {
    return asString(payload.thread_id);
  }
  return undefined;
}

function isAuthoritativeCodexResumeFailure(error: string): boolean {
  return [
    /resume session not found/i,
    /invalid session/i,
    /session .*invalid/i,
    /unknown session/i,
    /cannot resume/i,
    /not resumable/i,
  ].some(pattern => pattern.test(error));
}

export function extractCodexPermissionRequest(payload: unknown): ExtractedPermissionRequest | undefined {
  if (!isRecord(payload)) return undefined;

  const legacyType = asString(payload.type);
  if (legacyType === 'permission.requested') {
    const requestId = asStringOrNumber(payload.id);
    if (requestId == null) return undefined;
    return {
      requestId,
      tool: asString(payload.tool),
      reason: asString(payload.reason),
    };
  }

  const method = asString(payload.method);
  const requestId = asStringOrNumber(payload.id);
  if (!method || requestId == null) return undefined;

  const params = isRecord(payload.params) ? payload.params : {};
  if (method === 'item/commandExecution/requestApproval') {
    const command = Array.isArray(params.command)
      ? params.command.filter((value): value is string => typeof value === 'string').join(' ')
      : asString(params.command);
    return {
      requestId,
      tool: 'Bash',
      reason: asString(params.reason) ?? command,
    };
  }

  if (method === 'item/fileChange/requestApproval') {
    return {
      requestId,
      tool: 'Patch',
      reason: asString(params.reason),
    };
  }

  return undefined;
}

export function formatCodexPermissionDecision(
  requestId: string | number,
  decision: 'approved' | 'denied',
): string {
  return `${JSON.stringify({
    jsonrpc: '2.0',
    id: requestId,
    result: {
      decision: decision === 'approved' ? 'accept' : 'cancel',
    },
  })}\n`;
}

export function createCodexInitializeRequest(id: JsonRpcId): JsonRpcMessage {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      clientInfo: {
        name: CODEX_CLIENT_NAME,
        title: null,
        version: CODEX_CLIENT_VERSION,
      },
      capabilities: null,
    },
  };
}

export function createCodexInitializedNotification(): JsonRpcMessage {
  return {
    jsonrpc: '2.0',
    method: 'initialized',
  };
}

type SafeModeCodexRequestOptions = Pick<AgentSessionOptions, 'cwd' | 'model' | 'effort'>;

export function createCodexStartThreadRequest(
  id: JsonRpcId,
  options: SafeModeCodexRequestOptions,
): JsonRpcMessage {
  return {
    jsonrpc: '2.0',
    id,
    method: 'thread/start',
    params: {
      cwd: options.cwd,
      model: options.model,
      approvalPolicy: 'on-request',
      sandbox: 'read-only',
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    },
  };
}

export function createCodexResumeThreadRequest(
  id: JsonRpcId,
  options: SafeModeCodexRequestOptions & { threadId: string },
): JsonRpcMessage {
  return {
    jsonrpc: '2.0',
    id,
    method: 'thread/resume',
    params: {
      threadId: options.threadId,
      cwd: options.cwd,
      model: options.model,
      approvalPolicy: 'on-request',
      sandbox: 'read-only',
      persistExtendedHistory: false,
    },
  };
}

export function createCodexStartTurnRequest(
  id: JsonRpcId,
  options: SafeModeCodexRequestOptions & { threadId: string; prompt: string },
): JsonRpcMessage {
  return {
    jsonrpc: '2.0',
    id,
    method: 'turn/start',
    params: {
      threadId: options.threadId,
      input: [{
        type: 'text',
        text: options.prompt,
        text_elements: [],
      }],
      cwd: options.cwd,
      approvalPolicy: 'on-request',
      sandboxPolicy: {
        type: 'readOnly',
        access: {
          type: 'fullAccess',
        },
        networkAccess: true,
      },
      model: options.model,
      effort: options.effort,
    },
  };
}

export function createCodexArgs(
  options: AgentSessionOptions,
  permissionMode: PermissionMode = config.permissionMode,
): string[] {
  if (permissionMode === 'safe') {
    return ['app-server', '--listen', 'stdio://'];
  }

  const args = options.resumeSessionId
    ? ['exec', 'resume', options.resumeSessionId, '--json', '--skip-git-repo-check']
    : ['exec', '--json', '--skip-git-repo-check'];

  if (options.mode === 'code') {
    args.push('--full-auto');
  }

  if (options.model) {
    args.push('--model', options.model);
  }

  // --cd is only supported by `codex exec`, not `codex exec resume`
  // (resumed sessions remember their own working directory)
  if (options.cwd && !options.resumeSessionId) {
    args.push('--cd', options.cwd);
  }

  args.push('-');
  return args;
}

export function extractCodexEvents(
  payload: unknown,
  options: { resumeSessionId?: string } = {},
): AgentStreamEvent[] {
  if (!isRecord(payload)) return [];

  const method = asString(payload.method);
  if (method) {
    const params = isRecord(payload.params) ? payload.params : {};

    if (method === 'thread/started') {
      const thread = isRecord(params.thread) ? params.thread : undefined;
      const sessionId = thread ? asString(thread.id) : undefined;
      return sessionId
        ? [{ type: 'session', sessionId, status: 'confirmed' }]
        : [];
    }

    if (method === 'item/started') {
      const item = isRecord(params.item) ? params.item : undefined;
      if (!item || asString(item.type) !== 'commandExecution') {
        return [];
      }

      const command = asString(item.command);
      return command ? [{ type: 'tool', summary: formatCommandSummary(command) }] : [];
    }

    if (method === 'item/agentMessage/delta') {
      const delta = asString(params.delta);
      return delta ? [{ type: 'text', delta }] : [];
    }

    if (method === 'item/completed') {
      const item = isRecord(params.item) ? params.item : undefined;
      if (!item || asString(item.type) !== 'agentMessage') {
        return [];
      }

      const text = asString(item.text);
      return text ? [{ type: 'text', delta: text }] : [];
    }

    if (method === 'error') {
      const error = asString(params.message) ?? asString(params.error);
      if (!error) {
        return [];
      }

      return options.resumeSessionId && isAuthoritativeCodexResumeFailure(error)
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

  const type = asString(payload.type);
  if (!type) return [];

  const sessionId = extractCodexSessionId(payload);
  if (sessionId) {
    return [{
      type: 'session',
      sessionId,
      status: type === 'thread.resumed' ? 'resumed' : 'confirmed',
    }];
  }

  if (type === 'item.started') {
    const item = payload.item;
    if (!isRecord(item) || asString(item.type) !== 'command_execution') return [];

    const command = asString(item.command);
    return command ? [{ type: 'tool', summary: formatCommandSummary(command) }] : [];
  }

  if (type === 'item.completed') {
    const item = payload.item;
    if (!isRecord(item)) return [];

    if (asString(item.type) === 'agent_message') {
      const text = asString(item.text);
      return text ? [{ type: 'text', delta: text }] : [];
    }

    return [];
  }

  if (type === 'error' || type.endsWith('.failed')) {
    const error = asString(payload.message) ?? asString(payload.error);
    if (!error) {
      return [];
    }

    return options.resumeSessionId && isAuthoritativeCodexResumeFailure(error)
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

function readCodexConfigModel(): BackendModel[] {
  try {
    const configText = readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf8');
    const match = configText.match(/^model\s*=\s*"([^"\n]+)"/m);
    return match?.[1]
      ? [{ id: match[1], label: match[1] }]
      : [];
  } catch {
    return [];
  }
}

function readCodexModelCache(): BackendModel[] {
  try {
    const raw = JSON.parse(readFileSync(join(homedir(), '.codex', 'models_cache.json'), 'utf8')) as {
      models?: Array<{ slug?: string; display_name?: string }>;
    };
    if (!Array.isArray(raw.models)) {
      return [];
    }

    return raw.models.flatMap((model) => {
      const id = typeof model.slug === 'string' ? model.slug : undefined;
      if (!id) {
        return [];
      }

      return [{
        id,
        label: typeof model.display_name === 'string' ? model.display_name : id,
      }];
    });
  } catch {
    return [];
  }
}

function getSupportedCodexModels(): BackendModel[] {
  const cachedModels = readCodexModelCache();
  return cachedModels.length > 0 ? cachedModels : readCodexConfigModel();
}

type PendingCodexResponse = {
  resolve(payload: JsonRpcMessage): void;
  reject(error: Error): void;
};

function rejectPendingCodexResponses(
  pendingResponses: Map<string, PendingCodexResponse>,
  error: Error,
): void {
  for (const [id, pending] of pendingResponses.entries()) {
    pendingResponses.delete(id);
    pending.reject(error);
  }
}

function createEventQueue<T>() {
  const items: T[] = [];
  const waiters: Array<(value: T | null) => void> = [];
  let closed = false;

  return {
    push(value: T) {
      const waiter = waiters.shift();
      if (waiter) {
        waiter(value);
        return;
      }
      items.push(value);
    },
    close() {
      closed = true;
      while (waiters.length > 0) {
        waiters.shift()?.(null);
      }
    },
    async next(): Promise<T | null> {
      const item = items.shift();
      if (item) {
        return item;
      }
      if (closed) {
        return null;
      }
      return new Promise(resolve => waiters.push(resolve));
    },
  };
}

function writeJsonLine(
  stdin: NodeJS.WritableStream | null | undefined,
  payload: JsonRpcMessage,
): void {
  if (!stdin) {
    throw new Error('Codex CLI stdin is unavailable');
  }
  stdin.write(`${JSON.stringify(payload)}\n`);
}

function attachPermissionResponder(
  options: AgentSessionOptions,
  stdin: NodeJS.WritableStream | null | undefined,
) {
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

  const ready = (async () => {
    if (!options.conversationId || !stdin) {
      return;
    }

    const runtime = await import('../runtime.js');
    runtime.registerConversationPermissionResponder(options.conversationId, {
      backend: 'codex',
      respond(requestId, decision) {
        stdin.write(formatCodexPermissionDecision(requestId, decision));
      },
    });
    registerPermissionRequest = runtime.registerPermissionRequest;
  })();

  return {
    async handle(payload: unknown): Promise<Extract<AgentStreamEvent, { type: 'permission-requested' }> | undefined> {
      await ready;
      if (!registerPermissionRequest || !options.conversationId) {
        return undefined;
      }

      const permissionRequest = extractCodexPermissionRequest(payload);
      if (!permissionRequest) {
        return undefined;
      }

      const request = registerPermissionRequest({
        conversationId: options.conversationId,
        requestId: permissionRequest.requestId,
        backend: 'codex',
        tool: permissionRequest.tool,
        reason: permissionRequest.reason,
        timeoutMs: config.permissionRequestTimeoutMs,
      });

      return {
        type: 'permission-requested',
        requestId: request.requestId,
        backend: request.backend,
        tool: request.tool,
        reason: request.reason,
        expiresAt: request.expiresAt,
      };
    },
  };
}

async function* streamCodexExec(
  options: AgentSessionOptions,
  prompt: string,
  cwd: string,
  environmentCwd: string,
  environmentSource: 'explicit' | 'auto-detected' | 'default',
): AsyncGenerator<AgentStreamEvent, void> {
  const args = createCodexArgs({ ...options, prompt }, 'auto');

  const child = spawn(config.codexBin, args, {
    cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  writeCodexPrompt(child.stdin, prompt, false);

  const closePromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    },
  );

  const stderrLines: string[] = [];
  let abortReason: 'timeout' | 'aborted' | null = null;
  let sessionId: string | undefined = options.resumeSessionId ?? options.sessionId;

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
    if (options.abortSignal.aborted) onAbort();
  }

  const stderrReader = child.stderr ? readline.createInterface({ input: child.stderr }) : null;
  stderrReader?.on('line', (line) => { if (line.trim()) stderrLines.push(line.trim()); });

  const stdoutReader = child.stdout ? readline.createInterface({ input: child.stdout }) : null;
  let fullOutput = '';

  try {
    if (!stdoutReader) throw new Error('Codex CLI stdout is unavailable');

    for await (const rawLine of stdoutReader) {
      const line = rawLine.trimEnd();
      if (!line) continue;
      if (LOG_LINE_PATTERN.test(line)) {
        stderrLines.push(line);
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      sessionId = extractCodexSessionId(parsed) ?? sessionId;

      for (const event of extractCodexEvents(parsed, { resumeSessionId: options.resumeSessionId })) {
        if (event.type === 'text') {
          fullOutput += event.delta;

          for (const textLine of event.delta.split('\n')) {
            const cwdMatch = WORKING_DIR_PATTERN.exec(textLine.trim());
            if (cwdMatch?.[1]) {
              const detectedCwd = cwdMatch[1].trim();
              yield { type: 'status', status: `cwd:${detectedCwd}` };
              if (environmentCwd !== detectedCwd || environmentSource !== 'auto-detected') {
                environmentCwd = detectedCwd;
                environmentSource = 'auto-detected';
                yield {
                  type: 'environment',
                  environment: buildEnvironment('codex', options, environmentCwd, environmentSource, options.model),
                };
              }
            }
          }
        }

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
        ? `Codex CLI exited with signal ${signal}`
        : `Codex CLI exited with code ${String(code)}`;
      yield { type: 'error', error: details || fallback };
      return;
    }

    yield { type: 'done', result: fullOutput.trim(), sessionId };
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
    if (!child.killed) child.kill('SIGTERM');
    if (options.abortSignal) options.abortSignal.removeEventListener('abort', onAbort);
  }
}

export async function* streamCodexAppServer(
  options: AgentSessionOptions,
  prompt: string,
  cwd: string,
  environmentCwd: string,
  environmentSource: 'explicit' | 'auto-detected' | 'default',
): AsyncGenerator<AgentStreamEvent, void> {
  const child = spawn(config.codexBin, createCodexArgs(options, 'safe'), {
    cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const stderrLines: string[] = [];
  let abortReason: 'timeout' | 'aborted' | null = null;
  let sessionId: string | undefined = options.resumeSessionId ?? options.sessionId;
  let fullOutput = '';

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
    if (options.abortSignal.aborted) onAbort();
  }

  const stderrReader = child.stderr ? readline.createInterface({ input: child.stderr }) : null;
  stderrReader?.on('line', (line) => { if (line.trim()) stderrLines.push(line.trim()); });

  const stdoutReader = child.stdout ? readline.createInterface({ input: child.stdout }) : null;
  const pendingResponses = new Map<string, PendingCodexResponse>();
  const rejectPending = (error: Error) => {
    rejectPendingCodexResponses(pendingResponses, error);
  };
  const notifications = createEventQueue<JsonRpcMessage>();
  const permissionResponder = attachPermissionResponder(options, child.stdin);
  const closePromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', (error) => {
        rejectPending(error instanceof Error ? error : new Error(toErrorMessage(error)));
        reject(error);
      });
      child.once('close', (code, signal) => {
        if (pendingResponses.size > 0) {
          rejectPending(new Error(
            signal
              ? `Codex CLI exited with signal ${signal}`
              : `Codex CLI exited with code ${String(code)}`,
          ));
        }
        resolve({ code, signal });
      });
    },
  );

  try {
    if (!stdoutReader) {
      throw new Error('Codex CLI stdout is unavailable');
    }

    const consumeStdout = (async () => {
      try {
        for await (const rawLine of stdoutReader) {
          const line = rawLine.trimEnd();
          if (!line) continue;
          if (LOG_LINE_PATTERN.test(line)) {
            stderrLines.push(line);
            continue;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }

          if (!isRecord(parsed)) {
            continue;
          }

          const method = asString(parsed.method);
          const id = parsed.id;
          if (!method && (typeof id === 'string' || typeof id === 'number')) {
            const pending = pendingResponses.get(String(id));
            if (!pending) {
              continue;
            }

            pendingResponses.delete(String(id));
            if (isRecord(parsed.error)) {
              const message = asString(parsed.error.message) ?? 'Codex app-server request failed';
              pending.reject(new Error(message));
              continue;
            }
            pending.resolve(parsed);
            continue;
          }

          notifications.push(parsed);
        }
      } finally {
        notifications.close();
      }
    })();

    const sendRequest = async (payload: JsonRpcMessage): Promise<JsonRpcMessage> => {
      const id = payload.id;
      if (typeof id !== 'string' && typeof id !== 'number') {
        throw new Error('Codex JSON-RPC request id is required');
      }

      const response = new Promise<JsonRpcMessage>((resolve, reject) => {
        pendingResponses.set(String(id), { resolve, reject });
      });
      writeJsonLine(child.stdin, payload);
      return response;
    };

    await sendRequest(createCodexInitializeRequest(0));
    writeJsonLine(child.stdin, createCodexInitializedNotification());

    const threadResponse = options.resumeSessionId
      ? await sendRequest(createCodexResumeThreadRequest(1, {
          threadId: options.resumeSessionId,
          cwd: options.cwd,
          model: options.model,
          effort: options.effort,
        }))
      : await sendRequest(createCodexStartThreadRequest(1, {
          cwd: options.cwd,
          model: options.model,
          effort: options.effort,
        }));

    sessionId = extractCodexSessionId(threadResponse) ?? sessionId;
    if (sessionId) {
      yield {
        type: 'session',
        sessionId,
        status: options.resumeSessionId ? 'resumed' : 'confirmed',
      };
    }

    if (!sessionId) {
      throw new Error('Codex app-server did not return a thread id');
    }

    await sendRequest(createCodexStartTurnRequest(2, {
      threadId: sessionId,
      prompt,
      cwd: options.cwd,
      model: options.model,
      effort: options.effort,
    }));

    while (true) {
      const message = await notifications.next();
      if (!message) {
        break;
      }

      const permissionEvent = await permissionResponder.handle(message);
      if (permissionEvent) {
        yield permissionEvent;
        continue;
      }

      for (const event of extractCodexEvents(message, { resumeSessionId: options.resumeSessionId })) {
        if (event.type === 'text') {
          fullOutput += event.delta;

          for (const textLine of event.delta.split('\n')) {
            const cwdMatch = WORKING_DIR_PATTERN.exec(textLine.trim());
            if (cwdMatch?.[1]) {
              const detectedCwd = cwdMatch[1].trim();
              yield { type: 'status', status: `cwd:${detectedCwd}` };
              if (environmentCwd !== detectedCwd || environmentSource !== 'auto-detected') {
                environmentCwd = detectedCwd;
                environmentSource = 'auto-detected';
                yield {
                  type: 'environment',
                  environment: buildEnvironment('codex', options, environmentCwd, environmentSource, options.model),
                };
              }
            }
          }
        }

        yield event;
      }
    }

    await consumeStdout;
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
        ? `Codex CLI exited with signal ${signal}`
        : `Codex CLI exited with code ${String(code)}`;
      yield { type: 'error', error: details || fallback };
      return;
    }

    yield { type: 'done', result: fullOutput.trim(), sessionId };
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
    if (!child.killed) child.kill('SIGTERM');
    if (options.abortSignal) options.abortSignal.removeEventListener('abort', onAbort);
  }
}

async function* streamCodex(options: AgentSessionOptions): AsyncGenerator<AgentStreamEvent, void> {
  const cwd = options.cwd ?? config.claudeCwd;
  let environmentCwd = cwd;
  let environmentSource: 'explicit' | 'auto-detected' | 'default' = options.cwd ? 'explicit' : 'default';

  yield {
    type: 'environment',
    environment: buildEnvironment('codex', options, environmentCwd, environmentSource, options.model),
  };

  const prompt = options.cwd
    ? options.prompt
    : `请在开始任务前，先找到与本任务相关的项目目录，并在响应的第一行输出：Working directory: /absolute/path，然后再执行任务。\n\n${options.prompt}`;

  if (config.permissionMode === 'safe') {
    yield* streamCodexAppServer(options, prompt, cwd, environmentCwd, environmentSource);
    return;
  }

  yield* streamCodexExec(options, prompt, cwd, environmentCwd, environmentSource);
}

export const codexBackend: AgentBackend = {
  name: 'codex',
  isAvailable: () => isBackendCommandAvailable(config.codexBin),
  listModels: getSupportedCodexModels,
  stream: streamCodex,
};

registerBackend(codexBackend);
