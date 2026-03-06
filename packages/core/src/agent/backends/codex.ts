import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { config } from '../../config.js';
import { registerBackend, type AgentBackend } from '../backend.js';
import type { AgentSessionOptions, AgentStreamEvent } from '../session.js';

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

function extractCodexSessionId(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const type = asString(payload.type);
  if (type === 'thread.started' || type === 'thread.resumed') {
    return asString(payload.thread_id);
  }
  return undefined;
}

export function createCodexArgs(options: AgentSessionOptions): string[] {
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

export function extractCodexEvents(payload: unknown): AgentStreamEvent[] {
  if (!isRecord(payload)) return [];

  const type = asString(payload.type);
  if (!type) return [];

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
    return error ? [{ type: 'error', error }] : [];
  }

  return [];
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function* streamCodex(options: AgentSessionOptions): AsyncGenerator<AgentStreamEvent, void> {
  const cwd = options.cwd ?? config.claudeCwd;

  const prompt = options.cwd
    ? options.prompt
    : `请在开始任务前，先找到与本任务相关的项目目录，并在响应的第一行输出：Working directory: /absolute/path，然后再执行任务。\n\n${options.prompt}`;

  const args = createCodexArgs(options);

  const child = spawn(config.codexBin, args, {
    cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdin?.end(prompt);

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

      for (const event of extractCodexEvents(parsed)) {
        if (event.type === 'text') {
          fullOutput += event.delta;

          for (const textLine of event.delta.split('\n')) {
            const cwdMatch = WORKING_DIR_PATTERN.exec(textLine.trim());
            if (cwdMatch?.[1]) {
              yield { type: 'status', status: `cwd:${cwdMatch[1].trim()}` };
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
  stream: streamCodex,
};

registerBackend(codexBackend);
