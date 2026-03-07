import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveRelayPaths: vi.fn(() => ({
    homeDir: '/tmp/agent-inbox-cli/.agent-inbox',
    configFile: '/tmp/agent-inbox-cli/.agent-inbox/config.jsonl',
    stateDir: '/tmp/agent-inbox-cli/.agent-inbox/state',
    stateFile: '/tmp/agent-inbox-cli/.agent-inbox/state/sessions.json',
    artifactsDir: '/tmp/agent-inbox-cli/.agent-inbox/artifacts',
    logsDir: '/tmp/agent-inbox-cli/.agent-inbox/logs',
  })),
  loadAppConfig: vi.fn(),
  runSetup: vi.fn(),
  startSelectedIm: vi.fn(),
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
}));

vi.mock('../runtime.js', () => ({
  startSelectedIm: mocks.startSelectedIm,
}));

import { runCli } from '../cli.js';

describe('cli', () => {
  beforeEach(() => {
    mocks.loadAppConfig.mockReset();
    mocks.runSetup.mockReset();
    mocks.startSelectedIm.mockReset();
  });

  it('fails fast in non-interactive mode when multiple IMs are configured', async () => {
    mocks.loadAppConfig.mockResolvedValue({
      records: [],
      runtime: {},
      errors: [],
      availableIms: [
        {
          id: 'discord',
          config: {
            token: 'discord-token',
            clientId: 'discord-client',
          },
        },
        {
          id: 'feishu',
          config: {
            appId: 'feishu-app',
            appSecret: 'feishu-secret',
          },
        },
      ],
    });

    const input = new PassThrough() as PassThrough & { isTTY?: boolean };
    const output = new PassThrough() as PassThrough & { isTTY?: boolean };
    input.isTTY = false;
    output.isTTY = false;

    await expect(runCli({ input, output })).rejects.toThrow(
      /multiple im configurations found/i,
    );

    expect(mocks.startSelectedIm).not.toHaveBeenCalled();
  });
});
