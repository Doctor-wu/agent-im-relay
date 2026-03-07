import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runConversationSession } = vi.hoisted(() => ({
  runConversationSession: vi.fn(),
}));

vi.mock('../../agent/runtime.js', async () => {
  const actual = await vi.importActual<typeof import('../../agent/runtime.js')>('../../agent/runtime.js');
  return {
    ...actual,
    runConversationSession,
  };
});

import {
  activeConversations,
  applySessionControlCommand,
  conversationBackend,
  conversationCwd,
  conversationEffort,
  conversationModels,
  conversationSessions,
  openThreadSessionBinding,
  resolveThreadResumeMode,
  threadContinuationSnapshots,
  threadSessionBindings,
  updateThreadContinuationSnapshot,
} from '../../index.js';
import { runConversationWithRenderer } from '../conversation-runner.js';

async function drainEvents(events: AsyncIterable<unknown>): Promise<void> {
  for await (const _event of events) {
    // Drain the stream to trigger runner side effects.
  }
}

describe('runConversationWithRenderer', () => {
  beforeEach(() => {
    activeConversations.clear();
    conversationBackend.clear();
    conversationCwd.clear();
    conversationEffort.clear();
    conversationModels.clear();
    conversationSessions.clear();
    threadSessionBindings.clear();
    threadContinuationSnapshots.clear();
    runConversationSession.mockReset();
    runConversationSession.mockImplementation(async function* () {
      yield {
        type: 'environment',
        environment: {
          backend: 'claude',
          mode: 'code',
          model: {},
          cwd: { value: '/tmp/auto', source: 'auto-detected' },
          git: { isRepo: false },
        },
      };
      yield { type: 'status', status: 'cwd:/tmp/auto' };
      yield { type: 'done', result: 'done' };
    });
  });

  it('creates a pending sticky binding for the first message in a thread', async () => {
    const render = vi.fn(async (_options, events) => {
      await drainEvents(events);
    });
    const publishArtifacts = vi.fn(async () => {});

    const started = await runConversationWithRenderer({
      conversationId: 'conv-1',
      target: { id: 'channel-1' },
      prompt: 'hello',
      defaultCwd: '/tmp/workspace',
      render,
      publishArtifacts,
    });

    expect(started).toBe(true);
    expect(render).toHaveBeenCalledWith(
      { target: { id: 'channel-1' }, showEnvironment: true },
      expect.any(Object),
    );
    expect(runConversationSession).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      mode: 'code',
      prompt: expect.stringContaining('hello'),
      cwd: '/tmp/workspace',
      sessionId: expect.any(String),
    }));
    expect(threadSessionBindings.get('conv-1')).toEqual(expect.objectContaining({
      conversationId: 'conv-1',
      backend: 'claude',
      nativeSessionStatus: 'pending',
    }));
    expect(conversationSessions.has('conv-1')).toBe(false);
    expect(publishArtifacts).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      cwd: '/tmp/auto',
      resultText: 'done',
      sourceMessageId: undefined,
      target: { id: 'channel-1' },
    });
  });

  it('uses the existing sticky binding backend when no conversation backend is stored', async () => {
    threadSessionBindings.set('conv-binding-backend', {
      conversationId: 'conv-binding-backend',
      backend: 'codex',
      nativeSessionStatus: 'pending',
      lastSeenAt: '2026-03-08T00:00:00.000Z',
    });

    const render = vi.fn(async (_options, events) => {
      await drainEvents(events);
    });

    await runConversationWithRenderer({
      conversationId: 'conv-binding-backend',
      target: { id: 'channel-binding-backend' },
      prompt: 'continue',
      defaultCwd: '/tmp/workspace',
      render,
    });

    expect(runConversationSession).toHaveBeenCalledWith('conv-binding-backend', expect.objectContaining({
      backend: 'codex',
    }));
  });

  it('persists confirmed native session ids before terminal completion', async () => {
    const persist = vi.fn(async () => {});
    runConversationSession.mockImplementation(async function* () {
      yield {
        type: 'environment',
        environment: {
          backend: 'codex',
          mode: 'code',
          model: {},
          cwd: { value: '/tmp/workspace', source: 'explicit' },
          git: { isRepo: false },
        },
      };
      yield { type: 'session', sessionId: 'native-session-1', status: 'confirmed' };
      yield { type: 'done', result: 'done' };
    });

    const render = vi.fn(async (_options, events) => {
      for await (const event of events) {
        if (event.type === 'session') {
          expect(persist).toHaveBeenCalledTimes(1);
          expect(threadSessionBindings.get('conv-2')).toEqual(expect.objectContaining({
            nativeSessionId: 'native-session-1',
            nativeSessionStatus: 'confirmed',
          }));
        }
      }
    });

    await runConversationWithRenderer({
      conversationId: 'conv-2',
      target: { id: 'channel-2' },
      prompt: 'hello',
      defaultCwd: '/tmp/workspace',
      render,
      persist,
      backend: 'codex',
    });

    expect(conversationSessions.get('conv-2')).toBe('native-session-1');
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['Agent request timed out', 'timeout'],
    ['Agent request aborted', 'interrupted'],
  ] as const)('keeps the sticky thread open after %s', async (error, whyStopped) => {
    const render = vi.fn(async (_options, events) => {
      await drainEvents(events);
    });

    runConversationSession.mockImplementation(async function* () {
      yield {
        type: 'environment',
        environment: {
          backend: 'claude',
          mode: 'code',
          model: {},
          cwd: { value: '/tmp/workspace', source: 'explicit' },
          git: { isRepo: false },
        },
      };
      yield { type: 'error', error };
    });

    await runConversationWithRenderer({
      conversationId: `conv-${whyStopped}`,
      target: { id: `channel-${whyStopped}` },
      prompt: 'resume later',
      defaultCwd: '/tmp/workspace',
      render,
    });

    expect(threadSessionBindings.get(`conv-${whyStopped}`)).toEqual(expect.objectContaining({
      conversationId: `conv-${whyStopped}`,
      nativeSessionStatus: 'pending',
    }));
    expect(threadContinuationSnapshots.get(`conv-${whyStopped}`)).toEqual(expect.objectContaining({
      whyStopped,
    }));
    expect(resolveThreadResumeMode(`conv-${whyStopped}`).type).toBe('snapshot-resume');
  });

  it('uses snapshot fallback on the next message when native resume is unavailable', async () => {
    openThreadSessionBinding({
      conversationId: 'conv-snapshot',
      backend: 'claude',
      now: '2026-03-07T00:00:00.000Z',
    });
    updateThreadContinuationSnapshot({
      conversationId: 'conv-snapshot',
      taskSummary: 'Investigate the failing queue worker.',
      lastKnownCwd: '/tmp/queue-worker',
      whyStopped: 'timeout',
      nextStep: 'Pick up from the worker timeout investigation.',
      updatedAt: '2026-03-07T00:01:00.000Z',
    });
    conversationSessions.set('conv-snapshot', 'stale-session-id');

    const render = vi.fn(async (_options, events) => {
      await drainEvents(events);
    });

    await runConversationWithRenderer({
      conversationId: 'conv-snapshot',
      target: { id: 'channel-snapshot' },
      prompt: 'continue with the fix',
      defaultCwd: '/tmp/workspace',
      render,
    });

    expect(render).toHaveBeenCalledWith(
      { target: { id: 'channel-snapshot' }, showEnvironment: false },
      expect.any(Object),
    );
    const [, callOptions] = runConversationSession.mock.calls[0] ?? [];
    expect(callOptions).toEqual(expect.objectContaining({
      sessionId: expect.any(String),
      prompt: expect.stringContaining('Investigate the failing queue worker.'),
    }));
    expect(callOptions.resumeSessionId).toBeUndefined();
    expect(callOptions).toEqual(expect.objectContaining({
      prompt: expect.stringContaining('continue with the fix'),
    }));
  });

  it('does not resurrect sticky state after /done clears a run mid-stream', async () => {
    runConversationSession.mockImplementation(async function* () {
      yield {
        type: 'environment',
        environment: {
          backend: 'claude',
          mode: 'code',
          model: {},
          cwd: { value: '/tmp/workspace', source: 'explicit' },
          git: { isRepo: false },
        },
      };
      yield { type: 'session', sessionId: 'native-session-done', status: 'confirmed' };
      yield { type: 'done', result: 'done', sessionId: 'native-session-done' };
    });

    const render = vi.fn(async (_options, events) => {
      for await (const event of events) {
        if (event.type === 'session') {
          applySessionControlCommand({
            conversationId: 'conv-done-active',
            type: 'done',
          });
        }
      }
    });

    await expect(runConversationWithRenderer({
      conversationId: 'conv-done-active',
      target: { id: 'channel-done-active' },
      prompt: 'stop this thread',
      defaultCwd: '/tmp/workspace',
      render,
    })).resolves.toBe(true);

    expect(threadSessionBindings.has('conv-done-active')).toBe(false);
    expect(threadContinuationSnapshots.has('conv-done-active')).toBe(false);
    expect(conversationSessions.has('conv-done-active')).toBe(false);
  });

  it('invalidates stale native resumes and falls back to snapshot continuation next time', async () => {
    threadSessionBindings.set('conv-native-error', {
      conversationId: 'conv-native-error',
      backend: 'claude',
      nativeSessionId: 'stale-native-session',
      nativeSessionStatus: 'confirmed',
      lastSeenAt: '2026-03-07T00:02:00.000Z',
    });
    updateThreadContinuationSnapshot({
      conversationId: 'conv-native-error',
      taskSummary: 'Continue from the last good thread state.',
      whyStopped: 'completed',
      updatedAt: '2026-03-07T00:01:00.000Z',
    });
    conversationSessions.set('conv-native-error', 'stale-native-session');

    runConversationSession.mockImplementation(async function* () {
      yield {
        type: 'environment',
        environment: {
          backend: 'claude',
          mode: 'code',
          model: {},
          cwd: { value: '/tmp/workspace', source: 'explicit' },
          git: { isRepo: false },
        },
      };
      yield {
        type: 'session-invalidated',
        sessionId: 'stale-native-session',
        reason: 'Resume session not found',
      };
      yield { type: 'error', error: 'Resume session not found' };
    });

    const render = vi.fn(async (_options, events) => {
      await drainEvents(events);
    });

    await expect(runConversationWithRenderer({
      conversationId: 'conv-native-error',
      target: { id: 'channel-native-error' },
      prompt: 'continue',
      defaultCwd: '/tmp/workspace',
      render,
    })).resolves.toBe(true);

    expect(threadSessionBindings.get('conv-native-error')).toEqual(expect.objectContaining({
      nativeSessionStatus: 'invalid',
      nativeSessionId: 'stale-native-session',
    }));
    expect(conversationSessions.has('conv-native-error')).toBe(false);
    expect(resolveThreadResumeMode('conv-native-error').type).toBe('snapshot-resume');
  });

  it.each([
    ['Agent request timed out', 'timeout'],
    ['Agent request aborted', 'interrupted'],
  ] as const)('keeps confirmed native resume state after a resumed run ends with %s', async (error, whyStopped) => {
    threadSessionBindings.set('conv-native-transient', {
      conversationId: 'conv-native-transient',
      backend: 'claude',
      nativeSessionId: 'confirmed-native-session',
      nativeSessionStatus: 'confirmed',
      lastSeenAt: '2026-03-07T00:02:00.000Z',
    });
    updateThreadContinuationSnapshot({
      conversationId: 'conv-native-transient',
      taskSummary: 'Resume the existing task from native session state.',
      whyStopped: 'completed',
      updatedAt: '2026-03-07T00:01:00.000Z',
    });
    conversationSessions.set('conv-native-transient', 'confirmed-native-session');

    runConversationSession.mockImplementation(async function* () {
      yield {
        type: 'environment',
        environment: {
          backend: 'claude',
          mode: 'code',
          model: {},
          cwd: { value: '/tmp/workspace', source: 'explicit' },
          git: { isRepo: false },
        },
      };
      yield { type: 'error', error };
    });

    const render = vi.fn(async (_options, events) => {
      await drainEvents(events);
    });

    await expect(runConversationWithRenderer({
      conversationId: 'conv-native-transient',
      target: { id: 'channel-native-transient' },
      prompt: 'keep going',
      defaultCwd: '/tmp/workspace',
      render,
    })).resolves.toBe(true);

    expect(threadSessionBindings.get('conv-native-transient')).toEqual(expect.objectContaining({
      nativeSessionStatus: 'confirmed',
      nativeSessionId: 'confirmed-native-session',
    }));
    expect(threadContinuationSnapshots.get('conv-native-transient')).toEqual(expect.objectContaining({
      whyStopped,
    }));
    expect(conversationSessions.get('conv-native-transient')).toBe('confirmed-native-session');
    expect(resolveThreadResumeMode('conv-native-transient').type).toBe('native-resume');
  });

  it('does not leave a sticky binding behind when prompt preparation fails before the run starts', async () => {
    const render = vi.fn(async (_options, events) => {
      await drainEvents(events);
    });
    const preparePrompt = vi.fn(async () => {
      throw new Error('Failed to download attachment: spec.md');
    });

    await expect(runConversationWithRenderer({
      conversationId: 'conv-prepare-failure',
      target: { id: 'channel-prepare-failure' },
      prompt: 'use the attachment',
      defaultCwd: '/tmp/workspace',
      preparePrompt,
      render,
    })).rejects.toThrow('Failed to download attachment: spec.md');

    expect(runConversationSession).not.toHaveBeenCalled();
    expect(threadSessionBindings.has('conv-prepare-failure')).toBe(false);
    expect(threadContinuationSnapshots.has('conv-prepare-failure')).toBe(false);
    expect(conversationSessions.has('conv-prepare-failure')).toBe(false);
    expect(activeConversations.has('conv-prepare-failure')).toBe(false);
  });

  it('guards against concurrent runs on the same conversation', async () => {
    activeConversations.add('conv-busy');
    const render = vi.fn(async (_options, events) => {
      await drainEvents(events);
    });

    const started = await runConversationWithRenderer({
      conversationId: 'conv-busy',
      target: { id: 'channel-busy' },
      prompt: 'blocked',
      defaultCwd: '/tmp/workspace',
      render,
    });

    expect(started).toBe(false);
    expect(runConversationSession).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
});
