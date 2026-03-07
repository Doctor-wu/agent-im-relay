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
});
