import { parseWeChatConfig } from './config';
import { WeChatAdapter } from './adapter';
import type { WechatImConfig } from '@agent-im-relay/core';

export async function startWechatRuntime(): Promise<void> {
  const raw = buildConfigFromEnv();
  const config = parseWeChatConfig(raw);

  console.log(`[wechat] starting adapter "${config.name}"...`);

  const adapter = new WeChatAdapter(config, globalThis.fetch.bind(globalThis));

  adapter.onStatusChange((status) => {
    console.log(`[wechat] status: ${status}`);
  });

  adapter.onMessage((msg) => {
    console.log(`[wechat] message from ${msg.authorName}: ${msg.content.slice(0, 80)}`);
  });

  await adapter.start();
}

function buildConfigFromEnv(): WechatImConfig {
  return {
    name: process.env['WECHAT_NAME'] ?? 'wechat',
    sessionToken: process.env['WECHAT_SESSION_TOKEN'],
    reconnectMaxDelayMs: optionalNumber(process.env['WECHAT_RECONNECT_MAX_DELAY_MS']),
    heartbeatIntervalMs: optionalNumber(process.env['WECHAT_HEARTBEAT_INTERVAL_MS']),
    streamingCharThreshold: optionalNumber(process.env['WECHAT_STREAMING_CHAR_THRESHOLD']),
    streamingTimeThresholdMs: optionalNumber(process.env['WECHAT_STREAMING_TIME_THRESHOLD_MS']),
    selectionTimeoutMs: optionalNumber(process.env['WECHAT_SELECTION_TIMEOUT_MS']),
  };
}

function optionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
