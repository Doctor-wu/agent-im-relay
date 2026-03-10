import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBackend, type AgentBackend } from '../backend.js';
import type { AgentStreamEvent } from '../session.js';
import { createClaudeArgs, extractEvents, streamAgentSession } from '../session.js';
import { spawn } from 'node:child_process';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 128, stdout: '' })),
}));

type MockChildProcess = {
  stdout: Readable;
  stderr: Readable;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
};

function createMockChildProcess(
  lines: string[],
  options: { code?: number; signal?: NodeJS.Signals | null; stderrLines?: string[] } = {},
): MockChildProcess {
  const code = options.code ?? 0;
  const signal = options.signal ?? null;
  const stderrLines = options.stderrLines ?? [];
  return {
    stdout: Readable.from(lines.map(line => `${line}\n`)),
    stderr: Readable.from(stderrLines.map(line => `${line}\n`)),
    killed: false,
    kill: vi.fn(function mockKill(this: MockChildProcess) {
      this.killed = true;
      return true;
    }),
    once: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      if (event === 'close') {
        queueMicrotask(() => callback(code, signal));
      }
    }),
  };
}

async function collect(events: AsyncIterable<AgentStreamEvent>): Promise<AgentStreamEvent[]> {
  const collected: AgentStreamEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
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

  it('adds explicit model and effort arguments', () => {
    const args = createClaudeArgs({
      mode: 'code',
      prompt: 'summarize',
      model: 'sonnet',
      effort: 'high',
    });

    expect(args).toEqual(expect.arrayContaining(['--model', 'sonnet']));
    expect(args).toEqual(expect.arrayContaining(['--effort', 'high']));
    expect(args.at(-1)).toBe('summarize');
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

  it('emits a structured invalidation event for authoritative Claude resume failures', () => {
    expect(extractEvents({
      type: 'error',
      error: 'Invalid session ID for resume',
    }, {
      resumeSessionId: 'resume-456',
    })).toEqual([
      {
        type: 'session-invalidated',
        sessionId: 'resume-456',
        reason: 'Invalid session ID for resume',
      },
      { type: 'error', error: 'Invalid session ID for resume' },
    ]);
  });

  it('does not emit invalidation events for authoritative errors outside resume mode', () => {
    expect(extractEvents({
      type: 'error',
      error: 'Invalid session ID for resume',
    })).toEqual([
      { type: 'error', error: 'Invalid session ID for resume' },
    ]);
  });

  it('emits a session lifecycle event when Claude exposes an authoritative session id', () => {
    expect(extractEvents({
      type: 'system',
      status: 'ready',
      session_id: 'session-live',
    })).toEqual([
      { type: 'session', sessionId: 'session-live', status: 'confirmed' },
      { type: 'status', status: 'ready' },
    ]);

    const lifecycleEvent: AgentStreamEvent = {
      type: 'session',
      sessionId: 'session-live',
      status: 'confirmed',
    };

    expect(lifecycleEvent).toEqual({
      type: 'session',
      sessionId: 'session-live',
      status: 'confirmed',
    });
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

    expect(events[0]).toEqual({
      type: 'environment',
      environment: expect.objectContaining({
        backend: 'claude',
        mode: 'code',
        cwd: {
          value: expect.any(String),
          source: 'default',
        },
        git: {
          isRepo: false,
        },
      }),
    });
    expect(events.slice(1)).toEqual([
      { type: 'text', delta: 'Alpha' },
      { type: 'tool', summary: 'running Read {"file_path":"a.ts"}' },
      { type: 'done', result: 'Done', sessionId: 'session-final' },
      { type: 'error', error: 'Boom' },
    ]);

    expect(spawn).toHaveBeenCalledTimes(1);
    const [bin, args] = vi.mocked(spawn).mock.calls[0] ?? [];
    expect(bin).toBe('claude');
    expect(args).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json', '--verbose']));
    expect(args).toEqual(expect.arrayContaining(['--dangerously-skip-permissions']));
    expect(args.at(-1)).toContain('test prompt');
    expect(args.at(-1)).toContain('```artifacts');
  });

  it('rejects unavailable registered backends before starting a session', async () => {
    const backend: AgentBackend = {
      name: 'offline-test-backend',
      isAvailable: () => false,
      async *stream() {
        yield { type: 'done', result: 'should not run' } as const;
      },
    };

    registerBackend(backend);

    await expect(collect(streamAgentSession({
      mode: 'ask',
      prompt: 'test prompt',
      backend: 'offline-test-backend',
    }))).rejects.toThrow('Backend not available: offline-test-backend');
  });
});
