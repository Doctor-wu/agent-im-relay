import type { RelayPaths } from '@agent-im-relay/core';
import type {
  AppConfigRecord,
  DiscordImRecord,
  FeishuImRecord,
  LoadedAppConfig,
} from './config.js';
import { loadAppConfig, saveAppConfig, upsertRecord } from './config.js';
import {
  createPromptContext,
  promptSelect,
  promptText,
  type PromptContext,
  type PromptStreams,
} from './prompts.js';

async function buildDiscordRecord(context: PromptContext): Promise<DiscordImRecord> {
  const token = await promptText(context, 'Discord bot token');
  const clientId = await promptText(context, 'Discord application client ID');
  const guildIdsRaw = await promptText(context, 'Optional guild IDs (comma-separated)', { optional: true });

  return {
    type: 'im',
    id: 'discord',
    enabled: true,
    note: 'Discord bot credentials. Configure once, then the launcher can start Discord directly.',
    config: {
      token,
      clientId,
      guildIds: guildIdsRaw
        ? guildIdsRaw.split(',').map(id => id.trim()).filter(Boolean)
        : undefined,
    },
  };
}

async function buildFeishuRecord(context: PromptContext): Promise<FeishuImRecord> {
  const appId = await promptText(context, 'Feishu app ID');
  const appSecret = await promptText(context, 'Feishu app secret');
  const verificationToken = await promptText(context, 'Optional Feishu verification token', { optional: true });
  const encryptKey = await promptText(context, 'Optional Feishu encrypt key', { optional: true });
  const portRaw = await promptText(context, 'Optional local port', { optional: true, defaultValue: '3001' });

  return {
    type: 'im',
    id: 'feishu',
    enabled: true,
    note: 'Feishu single-process runtime. Only configured entries appear in the launcher.',
    config: {
      appId,
      appSecret,
      verificationToken: verificationToken || undefined,
      encryptKey: encryptKey || undefined,
      port: portRaw ? Number.parseInt(portRaw, 10) : undefined,
    },
  };
}

export async function runSetup(
  paths: RelayPaths,
  options: PromptStreams = {},
): Promise<LoadedAppConfig> {
  const context = createPromptContext(options);

  try {
    const selection = await promptSelect(context, 'Choose an IM to configure', [
      { value: 'discord', label: 'Discord' },
      { value: 'feishu', label: 'Feishu' },
    ] as const);

    const current = await loadAppConfig(paths);
    const nextRecord = selection === 'discord'
      ? await buildDiscordRecord(context)
      : await buildFeishuRecord(context);

    const nextRecords = upsertRecord(current.records as AppConfigRecord[], nextRecord);
    await saveAppConfig(paths, nextRecords);
    return loadAppConfig(paths);
  } finally {
    context.rl?.close();
  }
}
