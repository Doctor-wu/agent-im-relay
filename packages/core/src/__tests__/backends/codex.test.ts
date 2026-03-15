import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 128, stdout: '' })),
}));

import { spawn, spawnSync } from 'node:child_process';
import type { AgentStreamEvent } from '../../agent/session';
import {
  createCodexArgs,
  createCodexInitializeRequest,
  createCodexInitializedNotification,
  createCodexStartThreadRequest,
  createCodexResumeThreadRequest,
  createCodexStartTurnRequest,
  extractCodexEvents,
  extractCodexPermissionRequest,
  formatCodexPermissionDecision,
} from '../../agent/backends/codex';

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

  it('builds exec arguments that read prompt from stdin in auto mode', () => {
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

  it('keeps full-auto in auto mode and omits it in safe mode', () => {
    const autoArgs = createCodexArgs({
      mode: 'code',
      prompt: 'test',
    }, 'auto');
    const safeArgs = createCodexArgs({
      mode: 'code',
      prompt: 'test',
    }, 'safe');

    expect(autoArgs).toContain('--full-auto');
    expect(safeArgs).toEqual(['app-server', '--listen', 'stdio://']);
    expect(autoArgs.at(-1)).toBe('-');
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

  it('builds JSON-RPC bootstrap requests for safe mode', () => {
    expect(createCodexInitializeRequest(0)).toEqual({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        clientInfo: {
          name: 'agent-im-relay',
          title: null,
          version: '1.1.1',
        },
        capabilities: null,
      },
    });

    expect(createCodexInitializedNotification()).toEqual({
      jsonrpc: '2.0',
      method: 'initialized',
    });

    expect(createCodexStartThreadRequest(1, {
      cwd: '/tmp/project',
      model: 'gpt-5',
    })).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'thread/start',
      params: {
        cwd: '/tmp/project',
        model: 'gpt-5',
        approvalPolicy: 'on-request',
        sandbox: 'read-only',
        experimentalRawEvents: false,
        persistExtendedHistory: false,
      },
    });

    expect(createCodexResumeThreadRequest(2, {
      threadId: 'thread-123',
      cwd: '/tmp/project',
      model: 'gpt-5',
    })).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'thread/resume',
      params: {
        threadId: 'thread-123',
        cwd: '/tmp/project',
        model: 'gpt-5',
        approvalPolicy: 'on-request',
        sandbox: 'read-only',
        persistExtendedHistory: false,
      },
    });

    expect(createCodexStartTurnRequest(3, {
      threadId: 'thread-123',
      prompt: 'Create a file',
      cwd: '/tmp/project',
      model: 'gpt-5',
    })).toEqual({
      jsonrpc: '2.0',
      id: 3,
      method: 'turn/start',
      params: {
        threadId: 'thread-123',
        cwd: '/tmp/project',
        model: 'gpt-5',
        approvalPolicy: 'on-request',
        sandboxPolicy: {
          type: 'readOnly',
          access: {
            type: 'fullAccess',
          },
          networkAccess: true,
        },
        input: [{
          type: 'text',
          text: 'Create a file',
          text_elements: [],
        }],
      },
    });
  });

  it('extracts text and tool events from Codex JSONL items', () => {
    expect(extractCodexEvents({
      jsonrpc: '2.0',
      method: 'thread/started',
      params: {
        thread: {
          id: 'thread-123',
        },
      },
    })).toEqual([
      { type: 'session', sessionId: 'thread-123', status: 'confirmed' },
    ]);

    expect(extractCodexEvents({
      jsonrpc: '2.0',
      method: 'item/started',
      params: {
        threadId: 'thread-123',
        turnId: 'turn-123',
        item: {
          id: 'item_1',
          type: 'commandExecution',
          command: '/bin/zsh -lc "pwd"',
        },
      },
    })).toEqual([
      { type: 'tool', summary: 'running Bash {"command":"/bin/zsh -lc \\"pwd\\""}' },
    ]);

    expect(extractCodexEvents({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-123',
        turnId: 'turn-123',
        itemId: 'item_2',
        delta: 'Working directory: /tmp/project\n',
      },
    })).toEqual([
      { type: 'text', delta: 'Working directory: /tmp/project\n' },
    ]);

    expect(extractCodexEvents({
      jsonrpc: '2.0',
      method: 'item/completed',
      params: {
        threadId: 'thread-123',
        turnId: 'turn-123',
        item: {
          id: 'item_2',
          type: 'agentMessage',
          text: 'Done.',
        },
      },
    })).toEqual([
      { type: 'text', delta: 'Done.' },
    ]);
  });

  it('extracts permission requests from Codex approval payloads', () => {
    expect(extractCodexPermissionRequest({
      method: 'item/commandExecution/requestApproval',
      id: 'perm-1',
      params: {
        command: ['/bin/rm', '-rf', 'build'],
        cwd: '/tmp/project',
        reason: 'Run rm -rf build',
      },
    })).toEqual({
      requestId: 'perm-1',
      tool: 'Bash',
      reason: 'Run rm -rf build',
    });

    expect(extractCodexPermissionRequest({
      method: 'item/fileChange/requestApproval',
      id: 'perm-file-1',
      params: {
        reason: 'Edit package.json',
      },
    })).toEqual({
      requestId: 'perm-file-1',
      tool: 'Patch',
      reason: 'Edit package.json',
    });

    expect(extractCodexPermissionRequest({
      type: 'permission.requested',
      id: 'perm-2',
      tool: 'Bash',
      reason: 'Run rm -rf build',
    })).toEqual({
      requestId: 'perm-2',
      tool: 'Bash',
      reason: 'Run rm -rf build',
    });
  });

  it('preserves numeric id type in extracted permission requests', () => {
    expect(extractCodexPermissionRequest({
      method: 'item/commandExecution/requestApproval',
      id: 0,
      params: {
        command: ['ls'],
        reason: 'List files',
      },
    })).toEqual({
      requestId: 0,
      tool: 'Bash',
      reason: 'List files',
    });

    expect(extractCodexPermissionRequest({
      method: 'item/fileChange/requestApproval',
      id: 42,
      params: {
        reason: 'Edit file',
      },
    })).toEqual({
      requestId: 42,
      tool: 'Patch',
      reason: 'Edit file',
    });

    expect(extractCodexPermissionRequest({
      type: 'permission.requested',
      id: 7,
      tool: 'Bash',
      reason: 'Run command',
    })).toEqual({
      requestId: 7,
      tool: 'Bash',
      reason: 'Run command',
    });
  });

  it('formats Codex permission decisions as JSON-RPC responses', () => {
    expect(formatCodexPermissionDecision('perm-1', 'approved')).toBe(
      '{"jsonrpc":"2.0","id":"perm-1","result":{"decision":"accept"}}\n',
    );
    expect(formatCodexPermissionDecision('perm-1', 'denied')).toBe(
      '{"jsonrpc":"2.0","id":"perm-1","result":{"decision":"cancel"}}\n',
    );
  });

  it('emits an error instead of hanging when app-server exits before replying to a pending request', async () => {
    vi.mocked(spawn).mockReturnValue(
      makeProcess([
        JSON.stringify({ jsonrpc: '2.0', id: 0, result: { userAgent: 'codex-test' } }),
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: { thread: { id: 'thread-safe' } } }),
      ].join('\n'), '', 1) as any,
    );

    const { streamCodexAppServer } = await import('../../agent/backends/codex');
    const events = await collect(streamCodexAppServer(
      { mode: 'code', prompt: 'test prompt' },
      'test prompt',
      '/tmp/project',
      '/tmp/project',
      'explicit',
    ));

    expect(events).toEqual([
      { type: 'error', error: 'Codex CLI exited with code 1' },
    ]);
  });

  it('preserves numeric id type in formatted permission decisions', () => {
    expect(formatCodexPermissionDecision(0, 'approved')).toBe(
      '{"jsonrpc":"2.0","id":0,"result":{"decision":"accept"}}\n',
    );
    expect(formatCodexPermissionDecision(42, 'denied')).toBe(
      '{"jsonrpc":"2.0","id":42,"result":{"decision":"cancel"}}\n',
    );
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

    const { codexBackend } = await import('../../agent/backends/codex');
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

    const { codexBackend } = await import('../../agent/backends/codex');
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

    const { codexBackend } = await import('../../agent/backends/codex');
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

    const { codexBackend } = await import('../../agent/backends/codex');
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

    const { codexBackend } = await import('../../agent/backends/codex');
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
