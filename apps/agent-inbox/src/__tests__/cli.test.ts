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
  saveAppConfig: vi.fn(),
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
    saveAppConfig: mocks.saveAppConfig,
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

  it('shows Discord first by default when no last used platform is saved', async () => {
    mocks.loadAppConfig.mockResolvedValue({
      records: [],
      runtime: {},
      errors: [],
      lastUsedPlatform: undefined,
      availableIms: [
        {
          id: 'feishu' as const,
          config: { appId: 'feishu-app', appSecret: 'feishu-secret' },
        },
        {
          id: 'discord' as const,
          config: { token: 'discord-token', clientId: 'discord-client' },
        },
      ],
    });

    mocks.clackSelect.mockResolvedValue('discord');

    await runCli();

    expect(mocks.clackSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Select a platform to start',
        options: [
          expect.objectContaining({ value: 'discord', label: 'Discord (Recommended)' }),
          expect.objectContaining({ value: 'feishu', label: 'Feishu (飞书)' }),
        ],
      }),
    );
  });

  it('moves the last used platform to the top and labels it in the startup list', async () => {
    mocks.loadAppConfig.mockResolvedValue({
      records: [],
      runtime: {},
      errors: [],
      lastUsedPlatform: 'feishu',
      availableIms: [
        {
          id: 'discord' as const,
          config: { token: 'discord-token', clientId: 'discord-client' },
        },
        {
          id: 'feishu' as const,
          config: { appId: 'feishu-app', appSecret: 'feishu-secret' },
        },
      ],
    });

    mocks.clackSelect.mockResolvedValue('feishu');

    await runCli();

    expect(mocks.clackSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          expect.objectContaining({ value: 'feishu', hint: 'Last used' }),
          expect.objectContaining({ value: 'discord', label: 'Discord (Recommended)' }),
        ],
      }),
    );
  });

  it('overwrites the saved platform after a new manual selection', async () => {
    const discordRecord = {
      type: 'im' as const,
      id: 'discord' as const,
      enabled: true,
      config: { token: 'discord-token', clientId: 'discord-client' },
    };
    const feishuRecord = {
      type: 'im' as const,
      id: 'feishu' as const,
      enabled: true,
      config: { appId: 'feishu-app', appSecret: 'feishu-secret' },
    };

    mocks.loadAppConfig.mockResolvedValue({
      records: [
        { type: 'meta' as const, version: 1 },
        { type: 'local-preferences' as const, lastUsedPlatform: 'discord' as const },
        discordRecord,
        feishuRecord,
        { type: 'runtime' as const, config: {} },
      ],
      runtime: {},
      errors: [],
      lastUsedPlatform: 'discord',
      availableIms: [
        {
          id: 'discord' as const,
          config: { token: 'discord-token', clientId: 'discord-client' },
        },
        {
          id: 'feishu' as const,
          config: { appId: 'feishu-app', appSecret: 'feishu-secret' },
        },
      ],
    });

    mocks.clackSelect.mockResolvedValue('feishu');

    await runCli();

    expect(mocks.saveAppConfig).toHaveBeenCalledWith(
      expect.objectContaining({ configFile: expect.any(String) }),
      expect.arrayContaining([
        expect.objectContaining({
          type: 'local-preferences',
          lastUsedPlatform: 'feishu',
        }),
      ]),
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
