import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveRelayPaths: vi.fn(() => ({
    homeDir: '/tmp/agent-inbox-cli/.agent-inbox',
    configFile: '/tmp/agent-inbox-cli/.agent-inbox/config.jsonl',
    stateDir: '/tmp/agent-inbox-cli/.agent-inbox/state',
    stateFile: '/tmp/agent-inbox-cli/.agent-inbox/state/sessions.json',
    artifactsDir: '/tmp/agent-inbox-cli/.agent-inbox/artifacts',
    logsDir: '/tmp/agent-inbox-cli/.agent-inbox/logs',
    pidsDir: '/tmp/agent-inbox-cli/.agent-inbox/pids',
  })),
  loadAppConfig: vi.fn(),
  runSetup: vi.fn(),
  getUnconfiguredPlatforms: vi.fn(() => []),
  startSelectedIm: vi.fn(),
  acquirePidLock: vi.fn(async () => true),
  registerPidCleanup: vi.fn(),
  clackSelect: vi.fn(),
  clackIsCancel: vi.fn(() => false),
}));

vi.mock('@agent-im-relay/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agent-im-relay/core')>();
  return {
    ...actual,
    resolveRelayPaths: mocks.resolveRelayPaths,
  };
});

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return {
    ...actual,
    loadAppConfig: mocks.loadAppConfig,
  };
});

vi.mock('../setup.js', () => ({
  runSetup: mocks.runSetup,
  getUnconfiguredPlatforms: mocks.getUnconfiguredPlatforms,
  PLATFORM_LABELS: {
    discord: 'Discord (Recommended)',
    feishu: 'Feishu (飞书)',
  },
  ALL_PLATFORM_IDS: ['discord', 'feishu'],
}));

vi.mock('../runtime.js', () => ({
  startSelectedIm: mocks.startSelectedIm,
}));

vi.mock('../pid-lock.js', () => ({
  acquirePidLock: mocks.acquirePidLock,
  registerPidCleanup: mocks.registerPidCleanup,
}));

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  log: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  select: mocks.clackSelect,
  isCancel: mocks.clackIsCancel,
}));

import { runCli } from '../cli.js';

describe('cli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts the only configured IM directly after platform selection', async () => {
    const im = {
      id: 'discord' as const,
      config: { token: 'discord-token', clientId: 'discord-client' },
    };

    mocks.loadAppConfig.mockResolvedValue({
      records: [],
      runtime: {},
      errors: [],
      availableIms: [im],
    });

    mocks.clackSelect.mockResolvedValue('discord');

    await runCli();

    expect(mocks.startSelectedIm).toHaveBeenCalledWith(
      im,
      {},
      expect.objectContaining({ pidsDir: expect.any(String) }),
    );
  });

  it('enters setup on first run when no IM is configured yet', async () => {
    const im = {
      id: 'discord' as const,
      config: { token: 'discord-token', clientId: 'discord-client' },
    };

    mocks.loadAppConfig.mockResolvedValue({
      records: [],
      runtime: {},
      errors: [],
      availableIms: [],
    });
    mocks.getUnconfiguredPlatforms.mockReturnValue(['discord']);
    mocks.runSetup.mockResolvedValue({
      records: [],
      runtime: {},
      errors: [],
      availableIms: [im],
    });
    mocks.clackSelect.mockResolvedValue('discord');

    await runCli();

    expect(mocks.runSetup).toHaveBeenCalled();
    expect(mocks.startSelectedIm).toHaveBeenCalledWith(
      im,
      {},
      expect.objectContaining({ pidsDir: expect.any(String) }),
    );
  });

  it('rejects starting a platform that is already running', async () => {
    const im = {
      id: 'discord' as const,
      config: { token: 'discord-token', clientId: 'discord-client' },
    };

    mocks.loadAppConfig.mockResolvedValue({
      records: [],
      runtime: {},
      errors: [],
      availableIms: [im],
    });

    mocks.clackSelect.mockResolvedValue('discord');
    mocks.acquirePidLock.mockResolvedValue(false);

    await runCli();

    expect(mocks.startSelectedIm).not.toHaveBeenCalled();
  });
});
