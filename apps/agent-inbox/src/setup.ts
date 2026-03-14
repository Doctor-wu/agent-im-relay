import * as p from '@clack/prompts';
import type { RelayPaths } from '@agent-im-relay/core';
import type {
  AppConfigRecord,
  AvailableIm,
  DiscordImRecord,
  FeishuImRecord,
  SlackImRecord,
  LoadedAppConfig,
} from './config.js';
import type { TelegramImRecord } from './config.js';
import { loadAppConfig, saveAppConfig, upsertRecord } from './config.js';

const ALL_PLATFORM_IDS = ['discord', 'feishu', 'slack', 'telegram'] as const;
type PlatformId = (typeof ALL_PLATFORM_IDS)[number];

const PLATFORM_LABELS: Record<PlatformId, string> = {
  discord: 'Discord (Recommended)',
  feishu: 'Feishu (飞书)',
  slack: 'Slack',
  telegram: 'Telegram',
};

const PLATFORM_HINTS: Partial<Record<PlatformId, string>> = {
  discord: 'Best interactive workflow',
};

function getUnconfiguredPlatforms(availableIms: AvailableIm[]): PlatformId[] {
  const configured = new Set(availableIms.map(im => im.id));
  return ALL_PLATFORM_IDS.filter(id => !configured.has(id));
}

async function buildDiscordRecord(): Promise<DiscordImRecord> {
  const result = await p.group(
    {
      token: () =>
        p.password({
          message: 'Discord bot token',
          validate: v => (v.length === 0 ? 'Required' : undefined),
        }),
      clientId: () =>
        p.text({
          message: 'Application client ID',
          validate: v => (v.length === 0 ? 'Required' : undefined),
        }),
      guildIds: () =>
        p.text({
          message: 'Guild IDs (comma-separated, optional)',
          placeholder: 'Leave empty for global',
          defaultValue: '',
        }),
    },
    {
      onCancel: () => {
        p.cancel('Setup cancelled.');
        process.exit(0);
      },
    },
  );

  return {
    type: 'im',
    id: 'discord',
    enabled: true,
    note: 'Discord bot',
    config: {
      token: result.token,
      clientId: result.clientId,
      guildIds: result.guildIds
        ? result.guildIds
            .split(',')
            .map(id => id.trim())
            .filter(Boolean)
        : undefined,
    },
  };
}

async function buildFeishuRecord(): Promise<FeishuImRecord> {
  const result = await p.group(
    {
      appId: () =>
        p.text({
          message: 'Feishu app ID',
          validate: v => (v.length === 0 ? 'Required' : undefined),
        }),
      appSecret: () =>
        p.password({
          message: 'Feishu app secret',
          validate: v => (v.length === 0 ? 'Required' : undefined),
        }),
      verificationToken: () =>
        p.password({
          message: 'Verification token (optional)',
          defaultValue: '',
        }),
      encryptKey: () =>
        p.password({
          message: 'Encrypt key (optional)',
          defaultValue: '',
        }),
      port: () =>
        p.text({
          message: 'Local port',
          defaultValue: '3001',
        }),
    },
    {
      onCancel: () => {
        p.cancel('Setup cancelled.');
        process.exit(0);
      },
    },
  );

  return {
    type: 'im',
    id: 'feishu',
    enabled: true,
    note: 'Feishu app',
    config: {
      appId: result.appId,
      appSecret: result.appSecret,
      verificationToken: result.verificationToken || undefined,
      encryptKey: result.encryptKey || undefined,
      port: result.port ? Number.parseInt(result.port, 10) : undefined,
    },
  };
}

async function buildSlackRecord(): Promise<SlackImRecord> {
  const result = await p.group(
    {
      botToken: () =>
        p.password({
          message: 'Slack bot token',
          validate: v => (v.length === 0 ? 'Required' : undefined),
        }),
      appToken: () =>
        p.password({
          message: 'Slack app token',
          validate: v => (v.length === 0 ? 'Required' : undefined),
        }),
      signingSecret: () =>
        p.password({
          message: 'Slack signing secret',
          validate: v => (v.length === 0 ? 'Required' : undefined),
        }),
      socketMode: () =>
        p.select({
          message: 'Use Socket Mode?',
          options: [
            { value: true, label: 'Yes' },
            { value: false, label: 'No' },
          ],
        }),
    },
    {
      onCancel: () => {
        p.cancel('Setup cancelled.');
        process.exit(0);
      },
    },
  );

  return {
    type: 'im',
    id: 'slack',
    enabled: true,
    note: 'Slack app',
    config: {
      botToken: result.botToken,
      appToken: result.appToken,
      signingSecret: result.signingSecret,
      socketMode: result.socketMode,
    },
  };
}

async function buildTelegramRecord(): Promise<TelegramImRecord> {
  const result = await p.group(
    {
      botToken: () =>
        p.password({
          message: 'Telegram bot token (from @BotFather)',
          validate: v => (!v || v.length === 0 ? 'Required' : undefined),
        }),
      allowedUserIds: () =>
        p.text({
          message: 'Allowed user IDs (comma-separated, optional)',
          placeholder: 'Leave empty to allow all users',
        }),
    },
    {
      onCancel: () => {
        p.cancel('Setup cancelled.');
        process.exit(0);
      },
    },
  );

  const rawIds = result.allowedUserIds?.trim();
  const allowedUserIds = rawIds
    ? rawIds.split(',').map(s => Number.parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0)
    : undefined;

  return {
    type: 'im',
    id: 'telegram',
    enabled: true,
    note: 'Telegram bot',
    config: {
      botToken: result.botToken,
      allowedUserIds: allowedUserIds?.length ? allowedUserIds : undefined,
    },
  };
}

export async function runSetup(
  paths: RelayPaths,
  unconfiguredPlatforms: PlatformId[],
): Promise<LoadedAppConfig> {
  let platformId: PlatformId;

  if (unconfiguredPlatforms.length === 1) {
    platformId = unconfiguredPlatforms[0]!;
    p.log.info(`Configuring ${PLATFORM_LABELS[platformId]}...`);
  } else {
    const selected = await p.select({
      message: 'Which platform to configure?',
      options: unconfiguredPlatforms.map(id => ({
        value: id,
        label: PLATFORM_LABELS[id],
        hint: PLATFORM_HINTS[id],
      })),
    });

    if (p.isCancel(selected)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }

    platformId = selected;
  }

  const current = await loadAppConfig(paths);
  const nextRecord =
    platformId === 'discord'
      ? await buildDiscordRecord()
      : platformId === 'feishu'
        ? await buildFeishuRecord()
        : platformId === 'slack'
          ? await buildSlackRecord()
          : await buildTelegramRecord();

  const nextRecords = upsertRecord(
    current.records as AppConfigRecord[],
    nextRecord as AppConfigRecord,
  );
  await saveAppConfig(paths, nextRecords);

  p.log.success(`${PLATFORM_LABELS[platformId]} configured successfully!`);

  return loadAppConfig(paths);
}

export { getUnconfiguredPlatforms, ALL_PLATFORM_IDS, PLATFORM_LABELS };
export type { PlatformId };
