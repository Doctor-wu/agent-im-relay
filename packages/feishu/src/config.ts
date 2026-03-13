import { dirname, join } from 'node:path';
import {
  applyCoreConfigEnvironment,
  readFeishuRelayConfig,
  type FeishuRelayConfig,
} from '@agent-im-relay/core';

function setOptionalEnv(key: string, value: string | undefined): void {
  if (value) {
    process.env[key] = value;
    return;
  }

  delete process.env[key];
}

export interface FeishuConfig extends FeishuRelayConfig {}

export function resolveFeishuSessionChatStateFile(stateFile: string): string {
  return join(dirname(stateFile), 'feishu-session-chats.json');
}

export function resolveFeishuModelSelectionTimeoutMs(baseDir?: string): number {
  return readFeishuRelayConfig(baseDir).feishuModelSelectionTimeoutMs;
}

export function readFeishuConfig(baseDir?: string): FeishuConfig {
  return readFeishuRelayConfig(baseDir);
}

export function applyFeishuConfigEnvironment(config: FeishuConfig): void {
  applyCoreConfigEnvironment(config);
  process.env['FEISHU_APP_ID'] = config.feishuAppId;
  process.env['FEISHU_APP_SECRET'] = config.feishuAppSecret;
  setOptionalEnv('FEISHU_ENCRYPT_KEY', config.feishuEncryptKey);
  setOptionalEnv('FEISHU_VERIFICATION_TOKEN', config.feishuVerificationToken);
  process.env['FEISHU_BASE_URL'] = config.feishuBaseUrl;
  setOptionalEnv('FEISHU_PORT', config.feishuPort ? String(config.feishuPort) : undefined);
  process.env['FEISHU_MODEL_SELECTION_TIMEOUT_MS'] = String(config.feishuModelSelectionTimeoutMs);
}
