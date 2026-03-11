import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

const { readFileSyncMock } = vi.hoisted(() => ({
  readFileSyncMock: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: readFileSyncMock,
  };
});

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

import { spawn } from 'node:child_process';
import type { AgentStreamEvent } from '../../agent/session.js';
import { createOpencodeArgs, extractOpencodeEvents } from '../../agent/backends/opencode.js';

async function collect(gen: AsyncGenerator<AgentStreamEvent>): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

function makeProcess(stdout: string, stderr = '', exitCode = 0) {
  const stdoutStream = Readable.from([stdout]);
  const stderrStream = Readable.from([stderr]);
  return {
    stdout: stdoutStream,
    stderr: stderrStream,
    stdin: null,
    killed: false,
    kill: vi.fn(),
    once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'close') {
        setTimeout(() => cb(exitCode, null), 0);
      }
    }),
  };
}

describe('opencode backend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFileSyncMock.mockReset();
  });

  it('lists configured models as provider/modelKey values', async () => {
    readFileSyncMock.mockReturnValue(JSON.stringify({
      provider: {
        openai: {
          models: {
            'gpt-5': { name: 'GPT-5' },
            'gpt-4.1': {},
          },
        },
        anthropic: {
          models: {
            sonnet: { name: 'Claude Sonnet' },
          },
        },
      },
    }) as any);

    const { opencodeBackend } = await import('../../agent/backends/opencode.js');

    expect(opencodeBackend.listModels?.()).toEqual([
      { id: 'openai/gpt-5', label: 'openai/gpt-5' },
      { id: 'openai/gpt-4.1', label: 'openai/gpt-4.1' },
      { id: 'anthropic/sonnet', label: 'anthropic/sonnet' },
    ]);
  });

  it('falls back to the top-level model when provider metadata is absent', async () => {
    readFileSyncMock.mockReturnValue(JSON.stringify({
      model: 'openai/gpt-5',
    }) as any);

    const { opencodeBackend } = await import('../../agent/backends/opencode.js');

    expect(opencodeBackend.listModels?.()).toEqual([
      { id: 'openai/gpt-5', label: 'openai/gpt-5' },
    ]);
  });

  it('builds run arguments for a fresh session', () => {
    const args = createOpencodeArgs({
      mode: 'code',
      prompt: 'ship it',
      model: 'openai/gpt-5',
      effort: 'high',
    });

    expect(args).toEqual([
      'run',
      '--format',
      'json',
      '--model',
      'openai/gpt-5',
      '--variant',
      'high',
      'ship it',
    ]);
  });

  it('builds resume arguments when resuming a session', () => {
    const args = createOpencodeArgs({
      mode: 'ask',
      prompt: 'continue',
      resumeSessionId: 'ses_123',
    });

    expect(args).toEqual([
      'run',
      '--format',
      'json',
      '--session',
      'ses_123',
      'continue',
    ]);
  });

  it('does not add an invalid subagent override in ask mode', () => {
    const args = createOpencodeArgs({
      mode: 'ask',
      prompt: 'why?',
    });

    expect(args).toEqual([
      'run',
      '--format',
      'json',
      'why?',
    ]);
  });

  it('extracts session, tool, and text events from opencode JSONL output', () => {
    expect(extractOpencodeEvents({
      type: 'step_start',
      sessionID: 'ses_123',
    })).toEqual([
      { type: 'session', sessionId: 'ses_123', status: 'confirmed' },
    ]);

    expect(extractOpencodeEvents({
      type: 'tool_use',
      sessionID: 'ses_123',
      part: {
        type: 'tool',
        tool: 'bash',
        state: {
          input: {
            command: 'pwd',
          },
        },
      },
    })).toEqual([
      { type: 'tool', summary: 'running Bash {"command":"pwd"}' },
    ]);

    expect(extractOpencodeEvents({
      type: 'text',
      sessionID: 'ses_123',
      part: {
        type: 'text',
        text: 'Hello!',
      },
    })).toEqual([
      { type: 'text', delta: 'Hello!' },
    ]);
  });

  it('marks session events as resumed when extracting resumed runs', () => {
    expect(extractOpencodeEvents({
      type: 'step_start',
      sessionID: 'ses_123',
    }, {
      resumeSessionId: 'ses_123',
    })).toEqual([
      { type: 'session', sessionId: 'ses_123', status: 'resumed' },
    ]);
  });

  it('emits a structured invalidation event for authoritative resume failures', () => {
    expect(extractOpencodeEvents({
      type: 'error',
      error: {
        message: 'Resume session not found',
      },
    }, {
      resumeSessionId: 'ses_123',
    })).toEqual([
      {
        type: 'session-invalidated',
        sessionId: 'ses_123',
        reason: 'Resume session not found',
      },
      { type: 'error', error: 'Resume session not found' },
    ]);
  });

  it('emits environment, tool, text, and done events from the stream', async () => {
    vi.mocked(spawn).mockReturnValue(
      makeProcess([
        JSON.stringify({
          type: 'step_start',
          sessionID: 'ses_123',
          part: { type: 'step-start' },
        }),
        JSON.stringify({
          type: 'tool_use',
          sessionID: 'ses_123',
          part: {
            type: 'tool',
            tool: 'bash',
            state: {
              input: { command: 'pwd' },
            },
          },
        }),
        JSON.stringify({
          type: 'text',
          sessionID: 'ses_123',
          part: { type: 'text', text: 'Done.' },
        }),
      ].join('\n')) as any,
    );

    const { opencodeBackend } = await import('../../agent/backends/opencode.js');
    const events = await collect(opencodeBackend.stream({
      mode: 'code',
      prompt: 'ship it',
      cwd: '/tmp/project',
    }));

    expect(events[0]).toEqual({
      type: 'environment',
      environment: {
        backend: 'opencode',
        mode: 'code',
        model: {
          requested: undefined,
          resolved: undefined,
        },
        cwd: {
          value: '/tmp/project',
          source: 'explicit',
        },
        git: {
          isRepo: false,
        },
      },
    });
    expect(events.slice(1)).toEqual([
      { type: 'session', sessionId: 'ses_123', status: 'confirmed' },
      { type: 'tool', summary: 'running Bash {"command":"pwd"}' },
      { type: 'text', delta: 'Done.' },
      { type: 'done', result: 'Done.', sessionId: 'ses_123' },
    ]);

    expect(vi.mocked(spawn).mock.calls[0]).toEqual([
      expect.any(String),
      ['run', '--format', 'json', 'ship it'],
      expect.objectContaining({
        cwd: '/tmp/project',
      }),
    ]);
  });

  it('emits an error event on non-zero exit', async () => {
    vi.mocked(spawn).mockReturnValue(
      makeProcess('', 'ProviderModelNotFoundError: openai/gpt-does-not-exist', 1) as any,
    );

    const { opencodeBackend } = await import('../../agent/backends/opencode.js');
    const events = await collect(opencodeBackend.stream({
      mode: 'code',
      prompt: 'ship it',
    }));

    expect(events).toEqual([
      expect.objectContaining({
        type: 'environment',
      }),
      {
        type: 'error',
        error: 'ProviderModelNotFoundError: openai/gpt-does-not-exist',
      },
    ]);
  });

  it('emits an error event when the process only writes to stderr', async () => {
    vi.mocked(spawn).mockReturnValue(
      makeProcess('', 'ProviderModelNotFoundError: openai/gpt-does-not-exist', 0) as any,
    );

    const { opencodeBackend } = await import('../../agent/backends/opencode.js');
    const events = await collect(opencodeBackend.stream({
      mode: 'code',
      prompt: 'ship it',
    }));

    expect(events).toEqual([
      expect.objectContaining({
        type: 'environment',
      }),
      {
        type: 'error',
        error: 'ProviderModelNotFoundError: openai/gpt-does-not-exist',
      },
    ]);
  });
});
