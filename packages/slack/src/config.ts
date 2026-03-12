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

function optionalBooleanEnv(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const value = env[key]?.trim();
  if (!value) {
    return fallback;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new Error(`Invalid boolean environment variable: ${key}`);
}

function setOptionalBooleanEnv(key: string, value: boolean): void {
  process.env[key] = value ? 'true' : 'false';
}

export interface SlackConfig extends CoreConfig {
  slackBotToken: string;
  slackAppToken: string;
  slackSigningSecret: string;
  slackSocketMode: boolean;
}

export function resolveSlackConversationStateFile(stateFile: string): string {
  return join(dirname(stateFile), 'slack-conversations.json');
}

export function resolveSlackPendingRunStateFile(stateFile: string): string {
  return join(dirname(stateFile), 'slack-pending-runs.json');
}

export function readSlackConfig(env: NodeJS.ProcessEnv = process.env): SlackConfig {
  return {
    ...readCoreConfig(env),
    slackBotToken: requireEnv(env, 'SLACK_BOT_TOKEN'),
    slackAppToken: requireEnv(env, 'SLACK_APP_TOKEN'),
    slackSigningSecret: requireEnv(env, 'SLACK_SIGNING_SECRET'),
    slackSocketMode: optionalBooleanEnv(env, 'SLACK_SOCKET_MODE', true),
  };
}

export function applySlackConfigEnvironment(config: SlackConfig): void {
  applyCoreConfigEnvironment(config);
  process.env['SLACK_BOT_TOKEN'] = config.slackBotToken;
  process.env['SLACK_APP_TOKEN'] = config.slackAppToken;
  process.env['SLACK_SIGNING_SECRET'] = config.slackSigningSecret;
  setOptionalBooleanEnv('SLACK_SOCKET_MODE', config.slackSocketMode);
}
