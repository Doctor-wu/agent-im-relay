import {
  config as coreConfig,
  readDiscordRelayConfig,
  type DiscordRelayConfig,
} from '@agent-im-relay/core';

export type DiscordConfig = DiscordRelayConfig;

export function readDiscordConfig(baseDir?: string): DiscordConfig {
  return readDiscordRelayConfig(baseDir);
}

export const config = readDiscordConfig();

export { coreConfig };
