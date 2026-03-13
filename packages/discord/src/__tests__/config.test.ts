import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('discord config', () => {
  it('reads Discord config from ~/.agent-inbox/config.jsonl', async () => {
    const homeDir = await mkdtemp('/tmp/agent-inbox-discord-home-');
    const configDir = join(homeDir, '.agent-inbox');
    vi.stubEnv('HOME', homeDir);

    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'config.jsonl'), [
      '{"type":"meta","version":1}',
      '{"type":"runtime","config":{"streamUpdateIntervalMs":750,"discordMessageCharLimit":1800}}',
      '{"type":"im","id":"discord","enabled":true,"config":{"token":"discord-token","clientId":"discord-client-id","guildIds":["guild-1"],"allowedChannelIds":["channel-1"]}}',
    ].join('\n'), 'utf-8');

    await import('@agent-im-relay/core');

    const { readDiscordConfig } = await import('../config.js');
    const config = readDiscordConfig(homeDir);
    expect(config.discordToken).toBe('discord-token');
    expect(config.discordClientId).toBe('discord-client-id');
    expect(config.guildIds).toEqual(['guild-1']);
    expect(config.allowedChannelIds).toEqual(['channel-1']);
    expect(config.streamUpdateIntervalMs).toBe(750);
    expect(config.discordMessageCharLimit).toBe(1800);
    expect(config.stateFile).toBe(join(homeDir, '.agent-inbox', 'state', 'sessions.json'));
  });
});
