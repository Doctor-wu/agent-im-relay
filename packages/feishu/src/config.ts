import { config as dotenvConfig } from 'dotenv';
import { join, resolve } from 'node:path';

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

export interface FeishuConfig {
  agentTimeoutMs: number;
  claudeModel?: string;
  claudeCwd: string;
  stateFile: string;
  artifactsBaseDir: string;
  artifactRetentionDays: number;
  artifactMaxSizeBytes: number;
  claudeBin: string;
  codexBin: string;
  feishuAppId: string;
  feishuAppSecret: string;
  feishuEncryptKey?: string;
  feishuVerificationToken?: string;
  feishuBaseUrl: string;
  feishuPort: number;
  feishuClientId: string;
  feishuClientToken: string;
}

export interface FeishuRelayClientConfig {
  agentTimeoutMs: number;
  claudeModel?: string;
  claudeCwd: string;
  stateFile: string;
  artifactsBaseDir: string;
  artifactRetentionDays: number;
  artifactMaxSizeBytes: number;
  claudeBin: string;
  codexBin: string;
  feishuGatewayUrl: string;
  feishuClientId: string;
  feishuClientToken: string;
  feishuClientPollIntervalMs: number;
}

function readCoreConfig(env: NodeJS.ProcessEnv): Omit<FeishuConfig, 'feishuAppId' | 'feishuAppSecret' | 'feishuEncryptKey' | 'feishuVerificationToken' | 'feishuBaseUrl' | 'feishuPort'> {
  return {
    agentTimeoutMs: numberEnv(env, 'AGENT_TIMEOUT_MS', 10 * 60 * 1000),
    claudeModel: optionalEnv(env, 'CLAUDE_MODEL'),
    claudeCwd: optionalEnv(env, 'CLAUDE_CWD') || process.cwd(),
    stateFile: optionalEnv(env, 'STATE_FILE') || join(process.cwd(), 'data', 'sessions.json'),
    artifactsBaseDir: optionalEnv(env, 'ARTIFACTS_BASE_DIR') || join(process.cwd(), 'data', 'artifacts'),
    artifactRetentionDays: numberEnv(env, 'ARTIFACT_RETENTION_DAYS', 14),
    artifactMaxSizeBytes: numberEnv(env, 'ARTIFACT_MAX_SIZE_BYTES', 8 * 1024 * 1024),
    claudeBin: optionalEnv(env, 'CLAUDE_BIN') || '/opt/homebrew/bin/claude',
    codexBin: optionalEnv(env, 'CODEX_BIN') || '/opt/homebrew/bin/codex',
  };
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
    feishuClientId: requireEnv(env, 'FEISHU_CLIENT_ID'),
    feishuClientToken: requireEnv(env, 'FEISHU_CLIENT_TOKEN'),
  };
}

export function readManagedFeishuClientConfig(env: NodeJS.ProcessEnv = process.env): FeishuRelayClientConfig {
  return {
    ...readCoreConfig(env),
    feishuGatewayUrl: requireEnv(env, 'FEISHU_GATEWAY_URL'),
    feishuClientId: requireEnv(env, 'FEISHU_CLIENT_ID'),
    feishuClientToken: requireEnv(env, 'FEISHU_CLIENT_TOKEN'),
    feishuClientPollIntervalMs: numberEnv(env, 'FEISHU_CLIENT_POLL_INTERVAL_MS', 1_000),
  };
}
