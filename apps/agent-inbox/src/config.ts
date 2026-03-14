export {
  ensureDefaultRecords,
  loadRelayConfig as loadAppConfig,
  parseConfigJsonl,
  readRelayConfig,
  resolveAvailableIms,
  resolveLastUsedPlatform,
  resolveRuntimeConfig,
  saveRelayConfig as saveAppConfig,
  serializeConfigRecords,
  upsertRecord,
} from '@agent-im-relay/core';

export type {
  DiscordImConfig,
  DiscordImRecord,
  FeishuImConfig,
  FeishuImRecord,
  LoadedRelayConfig as LoadedAppConfig,
  LocalPreferencesRecord,
  MetaRecord,
  RelayConfigRecord as AppConfigRecord,
  RuntimeConfig,
  RuntimeRecord,
  SlackImConfig,
  SlackImRecord,
} from '@agent-im-relay/core';

import type { AvailableIm as CoreAvailableIm } from '@agent-im-relay/core';

export type TelegramImConfig = {
  botToken?: string;
  allowedUserIds?: number[];
};

export type TelegramImRecord = {
  type: 'im';
  id: 'telegram';
  enabled: boolean;
  note?: string;
  config: TelegramImConfig;
};

export type TelegramAvailableIm = {
  id: 'telegram';
  note?: string;
  config: Required<Pick<TelegramImConfig, 'botToken'>> & Pick<TelegramImConfig, 'allowedUserIds'>;
};

export type AvailableIm = CoreAvailableIm | TelegramAvailableIm;

