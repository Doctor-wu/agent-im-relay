import { afterEach, describe, expect, it, vi } from 'vitest';
import { glob, mkdir } from 'node:fs/promises';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadState, saveState } from '../persist.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('persist state loading', () => {
  it('quarantines malformed state files instead of retrying to parse them forever', async () => {
    const tempDir = await mkdtemp('/tmp/agent-inbox-persist-');
    const stateFile = join(tempDir, 'state', 'sessions.json');
    vi.stubEnv('STATE_FILE', stateFile);
    await mkdir(join(tempDir, 'state'), { recursive: true });
    await writeFile(stateFile, '{"sessions":{}}\n}broken', 'utf-8');

    const sessions = new Map<string, string>();
    const models = new Map<string, string>();
    const effort = new Map<string, string>();
    const cwd = new Map<string, string>();
    const backend = new Map<string, string>();
    const bindings = new Map();
    const snapshots = new Map();
    const savedCwdList: string[] = [];

    await loadState(
      sessions,
      models,
      effort,
      cwd,
      backend,
      bindings,
      snapshots,
      savedCwdList,
    );

    expect(sessions.size).toBe(0);
    const backups = await Array.fromAsync(glob(`${stateFile}.broken-*`));
    expect(backups.length).toBe(1);
    await expect(readFile(backups[0]!, 'utf-8')).resolves.toContain('}broken');
  });

  it('loads only the requested platform state from a shared state file', async () => {
    const tempDir = await mkdtemp('/tmp/agent-inbox-persist-');
    const stateFile = join(tempDir, 'state', 'sessions.json');
    vi.stubEnv('STATE_FILE', stateFile);
    await mkdir(join(tempDir, 'state'), { recursive: true });
    await writeFile(stateFile, JSON.stringify({
      sessions: {
        'discord:123456789012345678': 'discord-session',
        'feishu:oc_platform_only': 'feishu-session',
        'slack:1741766400.123456': 'slack-session',
      },
      models: {
        'discord:123456789012345678': 'claude-sonnet',
        'feishu:oc_platform_only': 'codex-mini',
        'slack:1741766400.123456': 'gpt-4.1',
      },
      effort: {},
      cwd: {
        'discord:123456789012345678': '/tmp/discord',
        'feishu:oc_platform_only': '/tmp/feishu',
        'slack:1741766400.123456': '/tmp/slack',
      },
      backend: {
        'discord:123456789012345678': 'claude',
        'feishu:oc_platform_only': 'codex',
        'slack:1741766400.123456': 'codex',
      },
      threadSessionBindings: {
        'discord:123456789012345678': {
          conversationId: '123456789012345678',
          backend: 'claude',
          nativeSessionId: 'discord-native',
          nativeSessionStatus: 'confirmed',
          lastSeenAt: '2026-03-09T00:00:00.000Z',
        },
        'feishu:oc_platform_only': {
          conversationId: 'oc_platform_only',
          backend: 'codex',
          nativeSessionId: 'feishu-native',
          nativeSessionStatus: 'confirmed',
          lastSeenAt: '2026-03-09T00:00:00.000Z',
        },
        'slack:1741766400.123456': {
          conversationId: '1741766400.123456',
          backend: 'codex',
          nativeSessionId: 'slack-native',
          nativeSessionStatus: 'confirmed',
          lastSeenAt: '2026-03-09T00:00:00.000Z',
        },
      },
      threadContinuationSnapshots: {
        'discord:123456789012345678': {
          conversationId: '123456789012345678',
          taskSummary: 'Finish the Discord task',
          whyStopped: 'completed',
          updatedAt: '2026-03-09T00:00:00.000Z',
        },
        'feishu:oc_platform_only': {
          conversationId: 'oc_platform_only',
          taskSummary: 'Finish the Feishu task',
          whyStopped: 'completed',
          updatedAt: '2026-03-09T00:00:00.000Z',
        },
        'slack:1741766400.123456': {
          conversationId: '1741766400.123456',
          taskSummary: 'Finish the Slack task',
          whyStopped: 'completed',
          updatedAt: '2026-03-09T00:00:00.000Z',
        },
      },
      savedCwdList: ['/tmp/shared'],
    }, null, 2), 'utf-8');

    const sessions = new Map<string, string>();
    const models = new Map<string, string>();
    const effort = new Map<string, string>();
    const cwd = new Map<string, string>();
    const backend = new Map<string, string>();
    const bindings = new Map();
    const snapshots = new Map();
    const savedCwdList: string[] = [];

    await loadState(
      sessions,
      models,
      effort,
      cwd,
      backend,
      bindings,
      snapshots,
      savedCwdList,
      { platform: 'discord' },
    );

    expect(sessions).toEqual(new Map([
      ['123456789012345678', 'discord-session'],
    ]));
    expect(models).toEqual(new Map([
      ['123456789012345678', 'claude-sonnet'],
    ]));
    expect(cwd).toEqual(new Map([
      ['123456789012345678', '/tmp/discord'],
    ]));
    expect(backend).toEqual(new Map([
      ['123456789012345678', 'claude'],
    ]));
    expect(bindings).toEqual(new Map([
      ['123456789012345678', {
        conversationId: '123456789012345678',
        backend: 'claude',
        nativeSessionId: 'discord-native',
        nativeSessionStatus: 'confirmed',
        lastSeenAt: '2026-03-09T00:00:00.000Z',
      }],
    ]));
    expect(snapshots).toEqual(new Map([
      ['123456789012345678', {
        conversationId: '123456789012345678',
        taskSummary: 'Finish the Discord task',
        whyStopped: 'completed',
        updatedAt: '2026-03-09T00:00:00.000Z',
      }],
    ]));
    expect(savedCwdList).toEqual(['/tmp/shared']);
  });

  it('loads only Slack platform state from a shared state file', async () => {
    const tempDir = await mkdtemp('/tmp/agent-inbox-persist-');
    const stateFile = join(tempDir, 'state', 'sessions.json');
    vi.stubEnv('STATE_FILE', stateFile);
    await mkdir(join(tempDir, 'state'), { recursive: true });
    await writeFile(stateFile, JSON.stringify({
      sessions: {
        'discord:123456789012345678': 'discord-session',
        'feishu:oc_platform_only': 'feishu-session',
        'slack:1741766400.123456': 'slack-session',
      },
      models: {
        'discord:123456789012345678': 'claude-sonnet',
        'feishu:oc_platform_only': 'codex-mini',
        'slack:1741766400.123456': 'gpt-4.1',
      },
      effort: {},
      cwd: {
        'discord:123456789012345678': '/tmp/discord',
        'feishu:oc_platform_only': '/tmp/feishu',
        'slack:1741766400.123456': '/tmp/slack',
      },
      backend: {
        'discord:123456789012345678': 'claude',
        'feishu:oc_platform_only': 'codex',
        'slack:1741766400.123456': 'codex',
      },
      threadSessionBindings: {
        'discord:123456789012345678': {
          conversationId: '123456789012345678',
          backend: 'claude',
          nativeSessionId: 'discord-native',
          nativeSessionStatus: 'confirmed',
          lastSeenAt: '2026-03-09T00:00:00.000Z',
        },
        'feishu:oc_platform_only': {
          conversationId: 'oc_platform_only',
          backend: 'codex',
          nativeSessionId: 'feishu-native',
          nativeSessionStatus: 'confirmed',
          lastSeenAt: '2026-03-09T00:00:00.000Z',
        },
        'slack:1741766400.123456': {
          conversationId: '1741766400.123456',
          backend: 'codex',
          nativeSessionId: 'slack-native',
          nativeSessionStatus: 'confirmed',
          lastSeenAt: '2026-03-09T00:00:00.000Z',
        },
      },
      threadContinuationSnapshots: {
        'discord:123456789012345678': {
          conversationId: '123456789012345678',
          taskSummary: 'Finish the Discord task',
          whyStopped: 'completed',
          updatedAt: '2026-03-09T00:00:00.000Z',
        },
        'feishu:oc_platform_only': {
          conversationId: 'oc_platform_only',
          taskSummary: 'Finish the Feishu task',
          whyStopped: 'completed',
          updatedAt: '2026-03-09T00:00:00.000Z',
        },
        'slack:1741766400.123456': {
          conversationId: '1741766400.123456',
          taskSummary: 'Finish the Slack task',
          whyStopped: 'completed',
          updatedAt: '2026-03-09T00:00:00.000Z',
        },
      },
      savedCwdList: ['/tmp/shared'],
    }, null, 2), 'utf-8');

    const sessions = new Map<string, string>();
    const models = new Map<string, string>();
    const effort = new Map<string, string>();
    const cwd = new Map<string, string>();
    const backend = new Map<string, string>();
    const bindings = new Map();
    const snapshots = new Map();
    const savedCwdList: string[] = [];

    await loadState(
      sessions,
      models,
      effort,
      cwd,
      backend,
      bindings,
      snapshots,
      savedCwdList,
      { platform: 'slack' },
    );

    expect(sessions).toEqual(new Map([
      ['1741766400.123456', 'slack-session'],
    ]));
    expect(models).toEqual(new Map([
      ['1741766400.123456', 'gpt-4.1'],
    ]));
    expect(cwd).toEqual(new Map([
      ['1741766400.123456', '/tmp/slack'],
    ]));
    expect(backend).toEqual(new Map([
      ['1741766400.123456', 'codex'],
    ]));
    expect(bindings).toEqual(new Map([
      ['1741766400.123456', {
        conversationId: '1741766400.123456',
        backend: 'codex',
        nativeSessionId: 'slack-native',
        nativeSessionStatus: 'confirmed',
        lastSeenAt: '2026-03-09T00:00:00.000Z',
      }],
    ]));
    expect(snapshots).toEqual(new Map([
      ['1741766400.123456', {
        conversationId: '1741766400.123456',
        taskSummary: 'Finish the Slack task',
        whyStopped: 'completed',
        updatedAt: '2026-03-09T00:00:00.000Z',
      }],
    ]));
    expect(savedCwdList).toEqual(['/tmp/shared']);
  });

  it('preserves other platform state when saving scoped runtime data', async () => {
    const tempDir = await mkdtemp('/tmp/agent-inbox-persist-');
    const stateFile = join(tempDir, 'state', 'sessions.json');
    vi.stubEnv('STATE_FILE', stateFile);
    await mkdir(join(tempDir, 'state'), { recursive: true });
    await writeFile(stateFile, JSON.stringify({
      sessions: {
        'feishu:oc_platform_only': 'feishu-session',
        'slack:1741766400.123456': 'slack-session',
      },
      models: {
        'feishu:oc_platform_only': 'codex-mini',
        'slack:1741766400.123456': 'gpt-4.1',
      },
      effort: {},
      cwd: {
        'feishu:oc_platform_only': '/tmp/feishu',
        'slack:1741766400.123456': '/tmp/slack',
      },
      backend: {
        'feishu:oc_platform_only': 'codex',
        'slack:1741766400.123456': 'codex',
      },
      threadSessionBindings: {
        'feishu:oc_platform_only': {
          conversationId: 'oc_platform_only',
          backend: 'codex',
          nativeSessionId: 'feishu-native',
          nativeSessionStatus: 'confirmed',
          lastSeenAt: '2026-03-09T00:00:00.000Z',
        },
        'slack:1741766400.123456': {
          conversationId: '1741766400.123456',
          backend: 'codex',
          nativeSessionId: 'slack-native',
          nativeSessionStatus: 'confirmed',
          lastSeenAt: '2026-03-09T00:00:00.000Z',
        },
      },
      threadContinuationSnapshots: {
        'feishu:oc_platform_only': {
          conversationId: 'oc_platform_only',
          taskSummary: 'Finish the Feishu task',
          whyStopped: 'completed',
          updatedAt: '2026-03-09T00:00:00.000Z',
        },
        'slack:1741766400.123456': {
          conversationId: '1741766400.123456',
          taskSummary: 'Finish the Slack task',
          whyStopped: 'completed',
          updatedAt: '2026-03-09T00:00:00.000Z',
        },
      },
      savedCwdList: ['/tmp/shared'],
    }, null, 2), 'utf-8');

    const sessions = new Map<string, string>([
      ['123456789012345678', 'discord-session'],
    ]);
    const models = new Map<string, string>([
      ['123456789012345678', 'claude-sonnet'],
    ]);
    const effort = new Map<string, string>();
    const cwd = new Map<string, string>([
      ['123456789012345678', '/tmp/discord'],
    ]);
    const backend = new Map<string, string>([
      ['123456789012345678', 'claude'],
    ]);
    const bindings = new Map([
      ['123456789012345678', {
        conversationId: '123456789012345678',
        backend: 'claude',
        nativeSessionId: 'discord-native',
        nativeSessionStatus: 'confirmed',
        lastSeenAt: '2026-03-09T00:00:00.000Z',
      }],
    ]);
    const snapshots = new Map([
      ['123456789012345678', {
        conversationId: '123456789012345678',
        taskSummary: 'Finish the Discord task',
        whyStopped: 'completed',
        updatedAt: '2026-03-09T00:00:00.000Z',
      }],
    ]);
    const savedCwdList: string[] = ['/tmp/shared'];

    await saveState(
      sessions,
      models,
      effort,
      cwd,
      backend,
      bindings,
      snapshots,
      savedCwdList,
      { platform: 'discord' },
    );

    expect(JSON.parse(await readFile(stateFile, 'utf-8'))).toEqual({
      sessions: {
        'feishu:oc_platform_only': 'feishu-session',
        'slack:1741766400.123456': 'slack-session',
        'discord:123456789012345678': 'discord-session',
      },
      models: {
        'feishu:oc_platform_only': 'codex-mini',
        'slack:1741766400.123456': 'gpt-4.1',
        'discord:123456789012345678': 'claude-sonnet',
      },
      effort: {},
      cwd: {
        'feishu:oc_platform_only': '/tmp/feishu',
        'slack:1741766400.123456': '/tmp/slack',
        'discord:123456789012345678': '/tmp/discord',
      },
      backend: {
        'feishu:oc_platform_only': 'codex',
        'slack:1741766400.123456': 'codex',
        'discord:123456789012345678': 'claude',
      },
      threadSessionBindings: {
        'feishu:oc_platform_only': {
          conversationId: 'oc_platform_only',
          backend: 'codex',
          nativeSessionId: 'feishu-native',
          nativeSessionStatus: 'confirmed',
          lastSeenAt: '2026-03-09T00:00:00.000Z',
        },
        'discord:123456789012345678': {
          conversationId: '123456789012345678',
          backend: 'claude',
          nativeSessionId: 'discord-native',
          nativeSessionStatus: 'confirmed',
          lastSeenAt: '2026-03-09T00:00:00.000Z',
        },
        'slack:1741766400.123456': {
          conversationId: '1741766400.123456',
          backend: 'codex',
          nativeSessionId: 'slack-native',
          nativeSessionStatus: 'confirmed',
          lastSeenAt: '2026-03-09T00:00:00.000Z',
        },
      },
      threadContinuationSnapshots: {
        'feishu:oc_platform_only': {
          conversationId: 'oc_platform_only',
          taskSummary: 'Finish the Feishu task',
          whyStopped: 'completed',
          updatedAt: '2026-03-09T00:00:00.000Z',
        },
        'discord:123456789012345678': {
          conversationId: '123456789012345678',
          taskSummary: 'Finish the Discord task',
          whyStopped: 'completed',
          updatedAt: '2026-03-09T00:00:00.000Z',
        },
        'slack:1741766400.123456': {
          conversationId: '1741766400.123456',
          taskSummary: 'Finish the Slack task',
          whyStopped: 'completed',
          updatedAt: '2026-03-09T00:00:00.000Z',
        },
      },
      savedCwdList: ['/tmp/shared'],
    });
  });
});
