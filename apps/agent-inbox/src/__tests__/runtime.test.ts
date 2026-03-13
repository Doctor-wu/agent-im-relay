import { describe, expect, it, vi } from 'vitest';
import { resolveRelayPaths } from '@agent-im-relay/core';
import { startSelectedIm } from '../runtime.js';
import type { AvailableIm } from '../config.js';

describe('runtime dispatch', () => {
  it('dispatches to the matching IM runtime and applies env vars', async () => {
    const startDiscordRuntime = vi.fn(async () => {});
    const selectedIm: AvailableIm = {
      id: 'discord',
      config: {
        token: 'discord-token',
        clientId: 'discord-client',
      },
    };

    await startSelectedIm(
      selectedIm,
      { agentTimeoutMs: 1234 },
      resolveRelayPaths('/tmp/runtime-dispatch'),
      {
        discord: async () => ({ startDiscordRuntime }),
      },
    );

    expect(startDiscordRuntime).toHaveBeenCalledOnce();
    expect(process.env['DISCORD_TOKEN']).toBe('discord-token');
    expect(process.env['AGENT_TIMEOUT_MS']).toBe('1234');
  });

  it('dispatches to the Slack runtime and applies Slack env vars', async () => {
    const startSlackRuntime = vi.fn(async () => {});
    const selectedIm: AvailableIm = {
      id: 'slack',
      config: {
        botToken: 'xoxb-test-token',
        appToken: 'xapp-test-token',
        signingSecret: 'test-signing-secret',
        socketMode: false,
      },
    };

    await startSelectedIm(
      selectedIm,
      { agentTimeoutMs: 4321 },
      resolveRelayPaths('/tmp/runtime-dispatch-slack'),
      {
        slack: async () => ({ startSlackRuntime }),
      },
    );

    expect(startSlackRuntime).toHaveBeenCalledOnce();
    expect(process.env['SLACK_BOT_TOKEN']).toBe('xoxb-test-token');
    expect(process.env['SLACK_SOCKET_MODE']).toBe('false');
    expect(process.env['AGENT_TIMEOUT_MS']).toBe('4321');
  });
});
