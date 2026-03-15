import * as p from '@clack/prompts';
import type { RelayPaths } from '@agent-im-relay/core';
import type {
  AppConfigRecord,
  AvailableIm,
  DiscordImRecord,
  FeishuImRecord,
  SlackImRecord,
  LoadedAppConfig,
} from './config';
import { loadAppConfig, saveAppConfig, upsertRecord } from './config';

const ALL_PLATFORM_IDS = ['discord', 'feishu', 'slack'] as const;
type PlatformId = (typeof ALL_PLATFORM_IDS)[number];

const PLATFORM_LABELS: Record<PlatformId, string> = {
  discord: 'Discord (Recommended)',
  feishu: 'Feishu (飞书)',
  slack: 'Slack',
};

const PLATFORM_HINTS: Partial<Record<PlatformId, string>> = {
  discord: 'Best interactive workflow',
};

function getUnconfiguredPlatforms(availableIms: AvailableIm[]): PlatformId[] {
  const configured = new Set(availableIms.map(im => im.id));
  return ALL_PLATFORM_IDS.filter(id => !configured.has(id));
}

function requireText(value: string | symbol | undefined): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Prompt input was cancelled or left empty.');
  }

  return value;
}

async function buildDiscordRecord(): Promise<DiscordImRecord> {
  const result = await p.group(
    {
      token: () =>
        p.password({
          message: 'Discord bot token',
          validate: v => (!v ? 'Required' : undefined),
        }),
      clientId: () =>
        p.text({
          message: 'Application client ID',
          validate: v => (!v ? 'Required' : undefined),
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
      token: requireText(result.token),
      clientId: requireText(result.clientId),
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
          validate: v => (!v ? 'Required' : undefined),
        }),
      appSecret: () =>
        p.password({
          message: 'Feishu app secret',
          validate: v => (!v ? 'Required' : undefined),
        }),
      verificationToken: () =>
        p.password({
          message: 'Verification token (optional)',
        }),
      encryptKey: () =>
        p.password({
          message: 'Encrypt key (optional)',
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
      appId: requireText(result.appId),
      appSecret: requireText(result.appSecret),
      verificationToken: typeof result.verificationToken === 'string' && result.verificationToken.length > 0
        ? result.verificationToken
        : undefined,
      encryptKey: typeof result.encryptKey === 'string' && result.encryptKey.length > 0
        ? result.encryptKey
        : undefined,
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
          validate: v => (!v ? 'Required' : undefined),
        }),
      appToken: () =>
        p.password({
          message: 'Slack app token',
          validate: v => (!v ? 'Required' : undefined),
        }),
      signingSecret: () =>
        p.password({
          message: 'Slack signing secret',
          validate: v => (!v ? 'Required' : undefined),
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
      botToken: requireText(result.botToken),
      appToken: requireText(result.appToken),
      signingSecret: requireText(result.signingSecret),
      socketMode: result.socketMode,
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
        : await buildSlackRecord();

  const nextRecords = upsertRecord(
    current.records as AppConfigRecord[],
    nextRecord,
  );
  await saveAppConfig(paths, nextRecords);

  p.log.success(`${PLATFORM_LABELS[platformId]} configured successfully!`);

  return loadAppConfig(paths);
}

export { getUnconfiguredPlatforms, ALL_PLATFORM_IDS, PLATFORM_LABELS };
export type { PlatformId };
