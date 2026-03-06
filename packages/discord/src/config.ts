import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'node:path';

dotenvConfig({ path: resolve(import.meta.dirname, '../../../.env') });
import { config as coreConfig } from '@agent-im-relay/core';

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function numberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric environment variable: ${key}`);
  }

  return parsed;
}

export const config = {
  ...coreConfig,
  discordToken: requireEnv('DISCORD_TOKEN'),
  discordClientId: requireEnv('DISCORD_CLIENT_ID'),
  guildIds: process.env['GUILD_IDS']
    ? process.env['GUILD_IDS'].split(',').map((id) => id.trim()).filter(Boolean)
    : [],
  streamUpdateIntervalMs: numberEnv('STREAM_UPDATE_INTERVAL_MS', 1000),
  discordMessageCharLimit: numberEnv('DISCORD_MESSAGE_CHAR_LIMIT', 1900),
};
