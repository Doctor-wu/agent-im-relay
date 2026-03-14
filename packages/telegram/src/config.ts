import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'node:path';
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
  const raw = env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
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

export interface TelegramConfig extends CoreConfig {
  telegramBotToken: string;
  telegramStreamUpdateIntervalMs: number;
  telegramMessageCharLimit: number;
  /** Optional comma-separated list of allowed user IDs */
  telegramAllowedUserIds?: number[];
}

export function readTelegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig {
  const rawAllowed = optionalEnv(env, 'TELEGRAM_ALLOWED_USER_IDS');
  const allowedUserIds = rawAllowed
    ? rawAllowed.split(',').map(s => Number.parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0)
    : undefined;

  return {
    ...readCoreConfig(env),
    telegramBotToken: requireEnv(env, 'TELEGRAM_BOT_TOKEN'),
    telegramStreamUpdateIntervalMs: numberEnv(env, 'STREAM_UPDATE_INTERVAL_MS', 1000),
    telegramMessageCharLimit: numberEnv(env, 'TELEGRAM_MESSAGE_CHAR_LIMIT', 4000),
    telegramAllowedUserIds: allowedUserIds?.length ? allowedUserIds : undefined,
  };
}

export function applyTelegramConfigEnvironment(config: TelegramConfig): void {
  applyCoreConfigEnvironment(config);
  process.env['TELEGRAM_BOT_TOKEN'] = config.telegramBotToken;
  setOptionalEnv(
    'TELEGRAM_ALLOWED_USER_IDS',
    config.telegramAllowedUserIds?.join(','),
  );
}
