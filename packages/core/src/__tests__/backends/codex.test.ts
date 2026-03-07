import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 128, stdout: '' })),
}));

import { spawn, spawnSync } from 'node:child_process';
import type { AgentStreamEvent } from '../../agent/session.js';
import { createCodexArgs, extractCodexEvents } from '../../agent/backends/codex.js';

async function collect(gen: AsyncGenerator<AgentStreamEvent>): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

function makeProcess(stdout: string, stderr = '', exitCode = 0) {
  const stdoutStream = Readable.from([stdout]);
  const stderrStream = Readable.from([stderr]);
  const proc = {
    stdout: stdoutStream,
    stderr: stderrStream,
    stdin: { write: vi.fn(), end: vi.fn() },
    killed: false,
    kill: vi.fn(),
    once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'close') setTimeout(() => cb(exitCode, null), 0);
    }),
  };
  return proc;
}

describe('codex backend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(spawnSync).mockReturnValue({ status: 128, stdout: '' } as any);
  });

  it('builds exec arguments that read prompt from stdin', () => {
    const args = createCodexArgs({
      mode: 'code',
      prompt: 'test',
      model: 'gpt-5',
      cwd: '/tmp/project',
    });

    expect(args).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--full-auto',
      '--model',
      'gpt-5',
      '--cd',
      '/tmp/project',
      '-',
    ]);
    expect(args).not.toContain('-q');
  });

  it('builds resume arguments when resuming a session', () => {
    const args = createCodexArgs({
      mode: 'code',
      prompt: 'test',
      resumeSessionId: 'session-123',
      model: 'gpt-5',
      cwd: '/tmp/project',
    });

    expect(args).toEqual([
      'exec',
      'resume',
      'session-123',
      '--json',
      '--skip-git-repo-check',
      '--full-auto',
      '--model',
      'gpt-5',
      '-',
    ]);
    // --cd is not supported by `codex exec resume`
    expect(args).not.toContain('--cd');
  });

  it('extracts text and tool events from Codex JSONL items', () => {
    expect(extractCodexEvents({
      type: 'thread.started',
      thread_id: 'thread-123',
    })).toEqual([
      { type: 'session', sessionId: 'thread-123', status: 'confirmed' },
    ]);

    expect(extractCodexEvents({
      type: 'thread.resumed',
      thread_id: 'thread-456',
    })).toEqual([
      { type: 'session', sessionId: 'thread-456', status: 'resumed' },
    ]);

    expect(extractCodexEvents({
      type: 'item.started',
      item: {
        id: 'item_1',
        type: 'command_execution',
        command: '/bin/zsh -lc "pwd"',
        status: 'in_progress',
      },
    })).toEqual([
      { type: 'tool', summary: 'running Bash {"command":"/bin/zsh -lc \\"pwd\\""}' },
    ]);

    expect(extractCodexEvents({
      type: 'item.completed',
      item: {
        id: 'item_2',
        type: 'agent_message',
        text: 'Working directory: /tmp/project\nDone.',
      },
    })).toEqual([
      { type: 'text', delta: 'Working directory: /tmp/project\nDone.' },
    ]);
  });

  it('emits a structured invalidation event for authoritative resume failures', () => {
    expect(extractCodexEvents({
      type: 'error',
      error: 'Resume session not found',
    }, {
      resumeSessionId: 'thread-123',
    })).toEqual([
      {
        type: 'session-invalidated',
        sessionId: 'thread-123',
        reason: 'Resume session not found',
      },
      { type: 'error', error: 'Resume session not found' },
    ]);
  });

  it('does not emit invalidation events for authoritative errors outside resume mode', () => {
    expect(extractCodexEvents({
      type: 'error',
      error: 'Resume session not found',
    })).toEqual([
      { type: 'error', error: 'Resume session not found' },
    ]);
  });

  it('emits text events from plain text output', async () => {
    vi.mocked(spawn).mockReturnValue(
      makeProcess([
        JSON.stringify({ type: 'thread.started', thread_id: 'thread-123' }),
        JSON.stringify({
          type: 'item.completed',
          item: { id: 'item_1', type: 'agent_message', text: 'Hello world' },
        }),
      ].join('\n')) as any,
    );

    const { codexBackend } = await import('../../agent/backends/codex.js');
    const events = await collect(codexBackend.stream({
      mode: 'code',
      prompt: 'test',
    }));

    expect(events[0]).toEqual({
      type: 'environment',
      environment: {
        backend: 'codex',
        mode: 'code',
        model: {
          requested: undefined,
          resolved: undefined,
        },
        cwd: {
          value: expect.any(String),
          source: 'default',
        },
        git: {
          isRepo: false,
        },
      },
    });
    expect(events.slice(1)).toEqual([
      { type: 'session', sessionId: 'thread-123', status: 'confirmed' },
      { type: 'text', delta: 'Hello world' },
      { type: 'done', result: 'Hello world', sessionId: 'thread-123' },
    ]);

    const [, args] = vi.mocked(spawn).mock.calls[0] ?? [];
    const proc = vi.mocked(spawn).mock.results[0]?.value as ReturnType<typeof makeProcess>;
    expect(args).toEqual(expect.arrayContaining(['exec', '--json', '--skip-git-repo-check', '-']));
    expect(args).not.toContain('-q');
    expect(proc.stdin.end).toHaveBeenCalledWith(expect.stringContaining('test'));
  });

  it('detects Working directory pattern', async () => {
    vi.mocked(spawn).mockReturnValue(
      makeProcess(JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_1',
          type: 'agent_message',
          text: 'Working directory: /home/user/project\nDone.',
        },
      })) as any,
    );

    const { codexBackend } = await import('../../agent/backends/codex.js');
    const events = await collect(codexBackend.stream({ mode: 'code', prompt: 'test' }));

    const status = events.find(e => e.type === 'status' && e.status.startsWith('cwd:'));
    const environment = events.findLast?.(
      (event) => event.type === 'environment',
    ) ?? [...events].reverse().find((event) => event.type === 'environment');
    expect(status).toBeDefined();
    expect((status as any).status).toBe('cwd:/home/user/project');
    expect(environment).toEqual({
      type: 'environment',
      environment: {
        backend: 'codex',
        mode: 'code',
        model: {
          requested: undefined,
          resolved: undefined,
        },
        cwd: {
          value: '/home/user/project',
          source: 'auto-detected',
        },
        git: {
          isRepo: false,
        },
      },
    });
  });

  it('emits explicit cwd and requested model in environment summary', async () => {
    vi.mocked(spawn).mockReturnValue(
      makeProcess(JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_1', type: 'agent_message', text: 'Hello from Codex' },
      })) as any,
    );

    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0, stdout: '/tmp/project\n' } as any)
      .mockReturnValueOnce({ status: 0, stdout: 'feature/demo\n' } as any);

    const { codexBackend } = await import('../../agent/backends/codex.js');
    const events = await collect(codexBackend.stream({
      mode: 'code',
      prompt: 'test',
      cwd: '/tmp/project',
      model: 'gpt-5-codex',
    }));

    expect(events[0]).toEqual({
      type: 'environment',
      environment: {
        backend: 'codex',
        mode: 'code',
        model: {
          requested: 'gpt-5-codex',
          resolved: 'gpt-5-codex',
        },
        cwd: {
          value: '/tmp/project',
          source: 'explicit',
        },
        git: {
          isRepo: true,
          repoRoot: '/tmp/project',
          branch: 'feature/demo',
        },
      },
    });
  });

  it('emits error event on non-zero exit', async () => {
    vi.mocked(spawn).mockReturnValue(makeProcess('', 'command not found', 1) as any);

    const { codexBackend } = await import('../../agent/backends/codex.js');
    const events = await collect(codexBackend.stream({ mode: 'code', prompt: 'test' }));

    expect(events.some(e => e.type === 'error')).toBe(true);
  });

  it('ignores warning items and log lines in json mode', async () => {
    vi.mocked(spawn).mockReturnValue(
      makeProcess([
        '2026-03-06T10:27:36.839767Z  WARN codex_protocol::openai_models: warning',
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_0',
            type: 'error',
            message: 'Under-development features enabled',
          },
        }),
        JSON.stringify({
          type: 'item.completed',
          item: { id: 'item_1', type: 'agent_message', text: 'Final answer' },
        }),
      ].join('\n')) as any,
    );

    const { codexBackend } = await import('../../agent/backends/codex.js');
    const events = await collect(codexBackend.stream({ mode: 'code', prompt: 'test' }));

    expect(events).toEqual([
      {
        type: 'environment',
        environment: {
          backend: 'codex',
          mode: 'code',
          model: {
            requested: undefined,
            resolved: undefined,
          },
          cwd: {
            value: expect.any(String),
            source: 'default',
          },
          git: {
            isRepo: false,
          },
        },
      },
      { type: 'text', delta: 'Final answer' },
      { type: 'done', result: 'Final answer', sessionId: undefined },
    ]);
  });
});
