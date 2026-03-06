import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentStreamEvent } from '../session.js';
import { createClaudeArgs, extractEvents, streamAgentSession } from '../session.js';
import { spawn } from 'node:child_process';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

type MockChildProcess = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
};

function createMockChildProcess(
  lines: string[],
  options: { code?: number; signal?: NodeJS.Signals | null; stderrLines?: string[] } = {},
): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });

  const code = options.code ?? 0;
  const signal = options.signal ?? null;
  const stderrLines = options.stderrLines ?? [];

  queueMicrotask(() => {
    for (const line of lines) {
      child.stdout.write(line + '\n');
    }
    for (const line of stderrLines) {
      child.stderr.write(line + '\n');
    }
    child.stdout.end();
    child.stderr.end();
    child.emit('close', code, signal);
  });

  return child;
}

describe('createClaudeArgs', () => {
  it('builds code-mode arguments with session id', () => {
    const args = createClaudeArgs({
      mode: 'code',
      prompt: 'fix this',
      sessionId: 'session-123',
    });

    expect(args.slice(0, 4)).toEqual(['-p', '--output-format', 'stream-json', '--verbose']);
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('--session-id');
    expect(args).toContain('session-123');
    expect(args.at(-1)).toBe('fix this');
  });

  it('builds ask-mode arguments with resume id', () => {
    const args = createClaudeArgs({
      mode: 'ask',
      prompt: 'why?',
      resumeSessionId: 'resume-456',
    });

    expect(args).toContain('--allowedTools');
    expect(args).toContain('');
    expect(args).toContain('--resume');
    expect(args).toContain('resume-456');
    expect(args).not.toContain('--session-id');
    expect(args.at(-1)).toBe('why?');
  });
});

describe('extractEvents', () => {
  it('parses assistant text deltas', () => {
    const payload = {
      type: 'assistant',
      delta: {
        type: 'text_delta',
        text: 'Hello',
      },
    };

    expect(extractEvents(payload)).toEqual([{ type: 'text', delta: 'Hello' }]);
  });

  it('parses assistant tool-use content blocks', () => {
    const payload = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/index.ts' } }],
      },
    };

    expect(extractEvents(payload)).toEqual([
      { type: 'tool', summary: 'running Read {"file_path":"src/index.ts"}' },
    ]);
  });

  it('parses stream_event payloads for deltas and tool start', () => {
    const deltaPayload = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'chunk' },
      },
    };

    const toolPayload = {
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
      },
    };

    expect(extractEvents(deltaPayload)).toEqual([{ type: 'text', delta: 'chunk' }]);
    expect(extractEvents(toolPayload)).toEqual([{ type: 'tool', summary: 'running Bash {"command":"ls"}' }]);
  });

  it('parses result and error payloads', () => {
    expect(extractEvents({ type: 'result', result: 'done', session_id: 's-1' })).toEqual([
      { type: 'done', result: 'done', sessionId: 's-1' },
    ]);
    expect(extractEvents({ type: 'error', error: 'boom' })).toEqual([{ type: 'error', error: 'boom' }]);
  });
});

describe('streamAgentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses stream-json lines from spawned process', async () => {
    const lines = [
      JSON.stringify({ type: 'assistant', delta: { type: 'text_delta', text: 'Alpha' } }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }] },
      }),
      JSON.stringify({ type: 'result', result: 'Done', session_id: 'session-final' }),
      JSON.stringify({ type: 'error', error: 'Boom' }),
    ];

    vi.mocked(spawn).mockReturnValue(createMockChildProcess(lines) as never);

    const events: AgentStreamEvent[] = [];
    for await (const event of streamAgentSession({ mode: 'code', prompt: 'test prompt' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'text', delta: 'Alpha' },
      { type: 'tool', summary: 'running Read {"file_path":"a.ts"}' },
      { type: 'done', result: 'Done', sessionId: 'session-final' },
      { type: 'error', error: 'Boom' },
    ]);

    expect(spawn).toHaveBeenCalledTimes(1);
    const [bin, args] = vi.mocked(spawn).mock.calls[0] ?? [];
    expect(bin).toBe('/opt/homebrew/bin/claude');
    expect(args).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json', '--verbose']));
    expect(args).toEqual(expect.arrayContaining(['--dangerously-skip-permissions', 'test prompt']));
  });
});
