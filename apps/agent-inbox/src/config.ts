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
  AvailableIm,
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
