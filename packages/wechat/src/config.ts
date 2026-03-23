import type { WechatImConfig } from '@agent-im-relay/core';

export interface WeChatConfig {
  name: string;
  sessionToken?: string;
  reconnectMaxDelayMs: number;
  heartbeatIntervalMs: number;
  streamingCharThreshold: number;
  streamingTimeThresholdMs: number;
  selectionTimeoutMs: number;
}

const DEFAULTS = {
  reconnectMaxDelayMs: 30_000,
  heartbeatIntervalMs: 30_000,
  streamingCharThreshold: 500,
  streamingTimeThresholdMs: 3_000,
  selectionTimeoutMs: 10_000,
} as const;

export function parseWeChatConfig(raw: WechatImConfig): WeChatConfig {
  if (!raw.name?.trim()) {
    throw new Error('WeChat config requires a non-empty "name" field');
  }

  return {
    name: raw.name.trim(),
    sessionToken: raw.sessionToken?.trim() || undefined,
    reconnectMaxDelayMs: raw.reconnectMaxDelayMs ?? DEFAULTS.reconnectMaxDelayMs,
    heartbeatIntervalMs: raw.heartbeatIntervalMs ?? DEFAULTS.heartbeatIntervalMs,
    streamingCharThreshold: raw.streamingCharThreshold ?? DEFAULTS.streamingCharThreshold,
    streamingTimeThresholdMs: raw.streamingTimeThresholdMs ?? DEFAULTS.streamingTimeThresholdMs,
    selectionTimeoutMs: raw.selectionTimeoutMs ?? DEFAULTS.selectionTimeoutMs,
  };
}

export { DEFAULTS as WECHAT_CONFIG_DEFAULTS };
