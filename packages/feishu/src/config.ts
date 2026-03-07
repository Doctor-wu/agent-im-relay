import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'node:path';
import { readCoreConfig, type CoreConfig } from '@agent-im-relay/core';

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
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric environment variable: ${key}`);
  }

  return parsed;
}

export interface FeishuConfig extends CoreConfig {
  feishuAppId: string;
  feishuAppSecret: string;
  feishuEncryptKey?: string;
  feishuVerificationToken?: string;
  feishuBaseUrl: string;
  feishuPort: number;
}

export function readFeishuConfig(env: NodeJS.ProcessEnv = process.env): FeishuConfig {
  return {
    ...readCoreConfig(env),
    feishuAppId: requireEnv(env, 'FEISHU_APP_ID'),
    feishuAppSecret: requireEnv(env, 'FEISHU_APP_SECRET'),
    feishuEncryptKey: optionalEnv(env, 'FEISHU_ENCRYPT_KEY'),
    feishuVerificationToken: optionalEnv(env, 'FEISHU_VERIFICATION_TOKEN'),
    feishuBaseUrl: optionalEnv(env, 'FEISHU_BASE_URL') || 'https://open.feishu.cn',
    feishuPort: numberEnv(env, 'FEISHU_PORT', 3001),
  };
}
