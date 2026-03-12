import { config as dotenvConfig } from 'dotenv';
import { dirname, join, resolve } from 'node:path';
import { applyCoreConfigEnvironment, readCoreConfig, type CoreConfig } from '@agent-im-relay/core';

dotenvConfig({ path: resolve(import.meta.dirname, '../../../.env') });

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  return env[key]?.trim() || undefined;
}

function numberEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric environment variable: ${key}`);
  }

  return parsed;
}

function setOptionalEnv(key: string, value: string | undefined): void {
  if (value) {
    process.env[key] = value;
    return;
  }

  delete process.env[key];
}

export interface FeishuConfig extends CoreConfig {
  feishuAppId: string;
  feishuAppSecret: string;
  feishuEncryptKey?: string;
  feishuVerificationToken?: string;
  feishuBaseUrl: string;
  feishuModelSelectionTimeoutMs: number;
}

export function resolveFeishuSessionChatStateFile(stateFile: string): string {
  return join(dirname(stateFile), 'feishu-session-chats.json');
}

export function resolveFeishuModelSelectionTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return numberEnv(env, 'FEISHU_MODEL_SELECTION_TIMEOUT_MS', 10_000);
}

export function readFeishuConfig(env: NodeJS.ProcessEnv = process.env): FeishuConfig {
  return {
    ...readCoreConfig(env),
    feishuAppId: requireEnv(env, 'FEISHU_APP_ID'),
    feishuAppSecret: requireEnv(env, 'FEISHU_APP_SECRET'),
    feishuEncryptKey: optionalEnv(env, 'FEISHU_ENCRYPT_KEY'),
    feishuVerificationToken: optionalEnv(env, 'FEISHU_VERIFICATION_TOKEN'),
    feishuBaseUrl: optionalEnv(env, 'FEISHU_BASE_URL') || 'https://open.feishu.cn',
    feishuModelSelectionTimeoutMs: resolveFeishuModelSelectionTimeoutMs(env),
  };
}

export function applyFeishuConfigEnvironment(config: FeishuConfig): void {
  applyCoreConfigEnvironment(config);
  process.env['FEISHU_APP_ID'] = config.feishuAppId;
  process.env['FEISHU_APP_SECRET'] = config.feishuAppSecret;
  setOptionalEnv('FEISHU_ENCRYPT_KEY', config.feishuEncryptKey);
  setOptionalEnv('FEISHU_VERIFICATION_TOKEN', config.feishuVerificationToken);
  process.env['FEISHU_BASE_URL'] = config.feishuBaseUrl;
  process.env['FEISHU_MODEL_SELECTION_TIMEOUT_MS'] = String(config.feishuModelSelectionTimeoutMs);
}
