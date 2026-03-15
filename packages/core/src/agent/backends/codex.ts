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
  requestId: string;
  tool?: string;
  reason?: string;
};

function extractCodexSessionId(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
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
    const requestId = asString(payload.id);
    if (!requestId) return undefined;
    return {
      requestId,
      tool: asString(payload.tool),
      reason: asString(payload.reason),
    };
  }

  const method = asString(payload.method);
  const requestId = asString(payload.id);
  if (!method || !requestId) return undefined;

  const params = isRecord(payload.params) ? payload.params : {};
  if (method === 'item/commandExecution/requestApproval') {
    const command = Array.isArray(params.command)
      ? params.command.filter((value): value is string => typeof value === 'string').join(' ')
      : undefined;
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
  requestId: string,
  decision: 'approved' | 'denied',
): string {
  return `${JSON.stringify({
    id: requestId,
    result: {
      decision: decision === 'approved' ? 'accept' : 'decline',
    },
  })}\n`;
}

export function createCodexArgs(
  options: AgentSessionOptions,
  permissionMode: PermissionMode = config.permissionMode,
): string[] {
  const args = options.resumeSessionId
    ? ['exec', 'resume', options.resumeSessionId, '--json', '--skip-git-repo-check']
    : ['exec', '--json', '--skip-git-repo-check'];

  if (options.mode === 'code' && permissionMode !== 'safe') {
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

  const permissionMode = config.permissionMode;
  const args = createCodexArgs({ ...options, prompt }, permissionMode);

  const child = spawn(config.codexBin, args, {
    cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  writeCodexPrompt(child.stdin, prompt, permissionMode === 'safe');

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

    let registerPermissionRequest:
      | ((options: {
        conversationId: string;
        requestId: string;
        backend: string;
        tool?: string;
        reason?: string;
        timeoutMs: number;
      }) => {
        requestId: string;
        backend: string;
        tool?: string;
        reason?: string;
        expiresAt: string;
      })
      | undefined;

    if (permissionMode === 'safe' && options.conversationId && child.stdin) {
      const runtime = await import('../runtime.js');
      runtime.registerConversationPermissionResponder(options.conversationId, {
        backend: 'codex',
        respond(requestId, decision) {
          child.stdin?.write(formatCodexPermissionDecision(requestId, decision));
        },
      });
      registerPermissionRequest = runtime.registerPermissionRequest;
    }

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

      if (registerPermissionRequest && options.conversationId) {
        const permissionRequest = extractCodexPermissionRequest(parsed);
        if (permissionRequest) {
          const request = registerPermissionRequest({
            conversationId: options.conversationId,
            requestId: permissionRequest.requestId,
            backend: 'codex',
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

export const codexBackend: AgentBackend = {
  name: 'codex',
  isAvailable: () => isBackendCommandAvailable(config.codexBin),
  listModels: getSupportedCodexModels,
  stream: streamCodex,
};

registerBackend(codexBackend);
