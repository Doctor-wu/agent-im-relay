import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('discord config', () => {
  it('uses runtime env overrides even if core was imported earlier', async () => {
    await import('@agent-im-relay/core');

    vi.stubEnv('DISCORD_TOKEN', 'discord-token');
    vi.stubEnv('DISCORD_CLIENT_ID', 'discord-client-id');
    vi.stubEnv('STATE_FILE', '/tmp/discord-runtime.json');

    const { config } = await import('../config.js');

    expect(config.discordToken).toBe('discord-token');
    expect(config.discordClientId).toBe('discord-client-id');
    expect(config.stateFile).toBe('/tmp/discord-runtime.json');
  });
});
