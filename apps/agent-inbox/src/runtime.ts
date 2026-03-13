import type { RelayPaths } from '@agent-im-relay/core';
import type { AvailableIm, RuntimeConfig } from './config.js';

type RuntimeLoaders = {
  discord?: () => Promise<{ startDiscordRuntime: () => Promise<unknown> }>;
  feishu?: () => Promise<{ startFeishuRuntime: () => Promise<unknown> }>;
  slack?: () => Promise<{ startSlackRuntime: () => Promise<unknown> }>;
};

function setOptionalEnv(key: string, value: string | undefined): void {
  if (value) {
    process.env[key] = value;
    return;
  }

  delete process.env[key];
}

function setNumericEnv(key: string, value: number | undefined): void {
  setOptionalEnv(key, value ? String(value) : undefined);
}

export function applyRuntimeEnvironment(
  selectedIm: AvailableIm,
  runtime: RuntimeConfig,
  paths: RelayPaths,
): void {
  process.env['STATE_FILE'] = paths.stateFile;
  process.env['ARTIFACTS_BASE_DIR'] = paths.artifactsDir;
  setNumericEnv('AGENT_TIMEOUT_MS', runtime.agentTimeoutMs);
  setNumericEnv('ARTIFACT_RETENTION_DAYS', runtime.artifactRetentionDays);
  setNumericEnv('ARTIFACT_MAX_SIZE_BYTES', runtime.artifactMaxSizeBytes);
  setNumericEnv('STREAM_UPDATE_INTERVAL_MS', runtime.streamUpdateIntervalMs);
  setNumericEnv('DISCORD_MESSAGE_CHAR_LIMIT', runtime.discordMessageCharLimit);

  delete process.env['DISCORD_TOKEN'];
  delete process.env['DISCORD_CLIENT_ID'];
  delete process.env['GUILD_IDS'];
  delete process.env['ALLOWED_CHANNEL_IDS'];
  delete process.env['FEISHU_APP_ID'];
  delete process.env['FEISHU_APP_SECRET'];
  delete process.env['FEISHU_VERIFICATION_TOKEN'];
  delete process.env['FEISHU_ENCRYPT_KEY'];
  delete process.env['FEISHU_BASE_URL'];
  delete process.env['FEISHU_PORT'];
  delete process.env['FEISHU_MODEL_SELECTION_TIMEOUT_MS'];
  delete process.env['SLACK_BOT_TOKEN'];
  delete process.env['SLACK_APP_TOKEN'];
  delete process.env['SLACK_SIGNING_SECRET'];
  delete process.env['SLACK_SOCKET_MODE'];

  if (selectedIm.id === 'discord') {
    process.env['DISCORD_TOKEN'] = selectedIm.config.token;
    process.env['DISCORD_CLIENT_ID'] = selectedIm.config.clientId;
    setOptionalEnv('GUILD_IDS', selectedIm.config.guildIds?.join(','));
    setOptionalEnv('ALLOWED_CHANNEL_IDS', selectedIm.config.allowedChannelIds?.join(','));
    return;
  }

  if (selectedIm.id === 'feishu') {
    process.env['FEISHU_APP_ID'] = selectedIm.config.appId;
    process.env['FEISHU_APP_SECRET'] = selectedIm.config.appSecret;
    setOptionalEnv('FEISHU_VERIFICATION_TOKEN', selectedIm.config.verificationToken);
    setOptionalEnv('FEISHU_ENCRYPT_KEY', selectedIm.config.encryptKey);
    setOptionalEnv('FEISHU_BASE_URL', selectedIm.config.baseUrl);
    setNumericEnv('FEISHU_PORT', selectedIm.config.port);
    setNumericEnv('FEISHU_MODEL_SELECTION_TIMEOUT_MS', selectedIm.config.modelSelectionTimeoutMs);
    return;
  }

  process.env['SLACK_BOT_TOKEN'] = selectedIm.config.botToken;
  process.env['SLACK_APP_TOKEN'] = selectedIm.config.appToken;
  process.env['SLACK_SIGNING_SECRET'] = selectedIm.config.signingSecret;
  setOptionalEnv('SLACK_SOCKET_MODE', String(selectedIm.config.socketMode ?? true));
}

export async function startSelectedIm(
  selectedIm: AvailableIm,
  runtime: RuntimeConfig,
  paths: RelayPaths,
  loaders: RuntimeLoaders = {},
): Promise<void> {
  applyRuntimeEnvironment(selectedIm, runtime, paths);

  if (selectedIm.id === 'discord') {
    const loadDiscord = loaders.discord ?? (() => import('@agent-im-relay/discord'));
    const discord = await loadDiscord();
    await discord.startDiscordRuntime();
    return;
  }

  if (selectedIm.id === 'feishu') {
    const loadFeishu = loaders.feishu ?? (() => import('@agent-im-relay/feishu'));
    const feishu = await loadFeishu();
    await feishu.startFeishuRuntime();
    return;
  }

  const loadSlack = loaders.slack ?? (() => import('@agent-im-relay/slack'));
  const slack = await loadSlack();
  await slack.startSlackRuntime();
}
