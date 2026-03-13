import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

async function createTempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'thread-session-'));
  tempDirs.push(dir);
  return dir;
}

async function loadThreadSessionModules(tempRootDir: string) {
  const relayDir = path.join(tempRootDir, '.agent-inbox');
  vi.stubEnv('HOME', tempRootDir);
  vi.stubEnv('INIT_CWD', '');
  await mkdir(relayDir, { recursive: true });
  await writeFile(path.join(relayDir, 'config.jsonl'), [
    JSON.stringify({ type: 'meta', version: 1 }),
  ].join('\n'), 'utf-8');

  const [state, manager] = await Promise.all([
    import('../../state.js'),
    import('../manager.js'),
  ]);

  return { state, manager };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await rm(dir, { recursive: true, force: true });
  }));
});

describe('thread-session manager', () => {
  it('opens a new binding with a pending native session state', async () => {
    const rootDir = await createTempRoot();
    const { state, manager } = await loadThreadSessionModules(rootDir);

    const binding = manager.openThreadSessionBinding({
      conversationId: 'conv-pending',
      backend: 'claude',
      now: '2026-03-07T00:00:00.000Z',
    });

    expect(binding).toEqual({
      conversationId: 'conv-pending',
      backend: 'claude',
      nativeSessionStatus: 'pending',
      lastSeenAt: '2026-03-07T00:00:00.000Z',
    });
    expect(state.threadSessionBindings.get('conv-pending')).toEqual(binding);
  });

  it('confirms a native session id for an open binding', async () => {
    const rootDir = await createTempRoot();
    const { state, manager } = await loadThreadSessionModules(rootDir);

    manager.openThreadSessionBinding({
      conversationId: 'conv-confirm',
      backend: 'codex',
      now: '2026-03-07T00:00:00.000Z',
    });

    const binding = manager.confirmThreadSessionBinding({
      conversationId: 'conv-confirm',
      nativeSessionId: 'native-session-1',
      now: '2026-03-07T00:01:00.000Z',
    });

    expect(binding).toEqual({
      conversationId: 'conv-confirm',
      backend: 'codex',
      nativeSessionId: 'native-session-1',
      nativeSessionStatus: 'confirmed',
      lastSeenAt: '2026-03-07T00:01:00.000Z',
    });
    expect(state.conversationSessions.get('conv-confirm')).toBe('native-session-1');
  });

  it('invalidates a native session without closing the sticky binding', async () => {
    const rootDir = await createTempRoot();
    const { state, manager } = await loadThreadSessionModules(rootDir);

    manager.openThreadSessionBinding({
      conversationId: 'conv-invalid',
      backend: 'claude',
      now: '2026-03-07T00:00:00.000Z',
    });
    manager.confirmThreadSessionBinding({
      conversationId: 'conv-invalid',
      nativeSessionId: 'native-session-2',
      now: '2026-03-07T00:01:00.000Z',
    });

    const binding = manager.invalidateThreadSessionBinding({
      conversationId: 'conv-invalid',
      now: '2026-03-07T00:02:00.000Z',
    });

    expect(binding).toEqual({
      conversationId: 'conv-invalid',
      backend: 'claude',
      nativeSessionId: 'native-session-2',
      nativeSessionStatus: 'invalid',
      lastSeenAt: '2026-03-07T00:02:00.000Z',
    });
    expect(state.threadSessionBindings.get('conv-invalid')).toEqual(binding);
    expect(state.conversationSessions.has('conv-invalid')).toBe(false);
  });

  it('saves and reloads continuation snapshots', async () => {
    const rootDir = await createTempRoot();
    const { state, manager } = await loadThreadSessionModules(rootDir);

    manager.openThreadSessionBinding({
      conversationId: 'conv-snapshot',
      backend: 'claude',
      now: '2026-03-07T00:00:00.000Z',
    });

    manager.updateThreadContinuationSnapshot({
      conversationId: 'conv-snapshot',
      taskSummary: 'Inspect the queue worker and preserve context.',
      lastKnownCwd: '/tmp/worktree',
      model: 'sonnet',
      effort: 'high',
      whyStopped: 'timeout',
      nextStep: 'Resume from the interrupted worker investigation.',
      updatedAt: '2026-03-07T00:03:00.000Z',
    });

    await state.persistState();

    const persistedState = JSON.parse(
      await readFile(path.join(rootDir, '.agent-inbox', 'state', 'sessions.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(persistedState).toMatchObject({
      threadSessionBindings: {
        'conv-snapshot': {
          nativeSessionStatus: 'pending',
        },
      },
      threadContinuationSnapshots: {
        'conv-snapshot': {
          whyStopped: 'timeout',
          nextStep: 'Resume from the interrupted worker investigation.',
        },
      },
    });

    state.conversationSessions.clear();
    state.conversationModels.clear();
    state.conversationEffort.clear();
    state.conversationCwd.clear();
    state.conversationBackend.clear();
    state.threadSessionBindings.clear();
    state.threadContinuationSnapshots.clear();

    await state.initState();

    expect(state.threadContinuationSnapshots.get('conv-snapshot')).toEqual({
      conversationId: 'conv-snapshot',
      taskSummary: 'Inspect the queue worker and preserve context.',
      lastKnownCwd: '/tmp/worktree',
      model: 'sonnet',
      effort: 'high',
      whyStopped: 'timeout',
      nextStep: 'Resume from the interrupted worker investigation.',
      updatedAt: '2026-03-07T00:03:00.000Z',
    });
  });

  it('clears both the binding and snapshot on close', async () => {
    const rootDir = await createTempRoot();
    const { state, manager } = await loadThreadSessionModules(rootDir);

    manager.openThreadSessionBinding({
      conversationId: 'conv-close',
      backend: 'codex',
      now: '2026-03-07T00:00:00.000Z',
    });
    manager.updateThreadContinuationSnapshot({
      conversationId: 'conv-close',
      taskSummary: 'Summarize the pending diff.',
      whyStopped: 'completed',
      updatedAt: '2026-03-07T00:04:00.000Z',
    });

    manager.closeThreadSession({
      conversationId: 'conv-close',
      now: '2026-03-07T00:05:00.000Z',
    });

    expect(state.threadSessionBindings.has('conv-close')).toBe(false);
    expect(state.threadContinuationSnapshots.has('conv-close')).toBe(false);
    expect(state.conversationSessions.has('conv-close')).toBe(false);
  });
});
