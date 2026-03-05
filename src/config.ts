import 'dotenv/config';

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
  anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
  guildIds: process.env['GUILD_IDS']
    ? process.env['GUILD_IDS'].split(',').map((id) => id.trim()).filter(Boolean)
    : [],
  maxTokens: numberEnv('MAX_TOKENS', 8192),
  maxTurns: numberEnv('MAX_TURNS', 20),
  agentTimeoutMs: numberEnv('AGENT_TIMEOUT_MS', 10 * 60 * 1000),
  streamUpdateIntervalMs: numberEnv('STREAM_UPDATE_INTERVAL_MS', 1000),
  discordMessageCharLimit: numberEnv('DISCORD_MESSAGE_CHAR_LIMIT', 1900),
  claudeModel: process.env['CLAUDE_MODEL'],
  anthropicBaseUrl: process.env['ANTHROPIC_BASE_URL'],
};
