import 'dotenv/config';
import { join } from 'node:path';

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
  discordToken: requireEnv('DISCORD_TOKEN'),
  discordClientId: requireEnv('DISCORD_CLIENT_ID'),
  guildIds: process.env['GUILD_IDS']
    ? process.env['GUILD_IDS'].split(',').map((id) => id.trim()).filter(Boolean)
    : [],
  agentTimeoutMs: numberEnv('AGENT_TIMEOUT_MS', 10 * 60 * 1000),
  streamUpdateIntervalMs: numberEnv('STREAM_UPDATE_INTERVAL_MS', 1000),
  discordMessageCharLimit: numberEnv('DISCORD_MESSAGE_CHAR_LIMIT', 1900),
  claudeModel: process.env['CLAUDE_MODEL'],
  claudeCwd: process.env['CLAUDE_CWD']?.trim() || process.cwd(),
  stateFile: process.env['STATE_FILE']?.trim() || join(process.cwd(), 'data', 'sessions.json'),
};
