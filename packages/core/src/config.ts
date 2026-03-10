import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'node:path';
import { resolveRelayPaths } from './paths.js';

dotenvConfig({ path: resolve(import.meta.dirname, '../../../.env') });

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

function setNumericEnv(key: string, value: number): void {
  process.env[key] = String(value);
}

export interface CoreConfig {
  agentTimeoutMs: number;
  claudeCwd: string;
  stateFile: string;
  artifactsBaseDir: string;
  artifactRetentionDays: number;
  artifactMaxSizeBytes: number;
  claudeBin: string;
  codexBin: string;
  opencodeBin: string;
}

export function readCoreConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  const relayPaths = resolveRelayPaths();

  return {
    agentTimeoutMs: numberEnv(env, 'AGENT_TIMEOUT_MS', 10 * 60 * 1000),
    claudeCwd: optionalEnv(env, 'CLAUDE_CWD') || process.cwd(),
    stateFile: optionalEnv(env, 'STATE_FILE') || relayPaths.stateFile,
    artifactsBaseDir: optionalEnv(env, 'ARTIFACTS_BASE_DIR') || relayPaths.artifactsDir,
    artifactRetentionDays: numberEnv(env, 'ARTIFACT_RETENTION_DAYS', 14),
    artifactMaxSizeBytes: numberEnv(env, 'ARTIFACT_MAX_SIZE_BYTES', 8 * 1024 * 1024),
    claudeBin: optionalEnv(env, 'CLAUDE_BIN') || 'claude',
    codexBin: optionalEnv(env, 'CODEX_BIN') || 'codex',
    opencodeBin: optionalEnv(env, 'OPENCODE_BIN') || 'opencode',
  };
}

export function applyCoreConfigEnvironment(config: CoreConfig): void {
  setNumericEnv('AGENT_TIMEOUT_MS', config.agentTimeoutMs);
  delete process.env['CLAUDE_MODEL'];
  process.env['CLAUDE_CWD'] = config.claudeCwd;
  process.env['STATE_FILE'] = config.stateFile;
  process.env['ARTIFACTS_BASE_DIR'] = config.artifactsBaseDir;
  setNumericEnv('ARTIFACT_RETENTION_DAYS', config.artifactRetentionDays);
  setNumericEnv('ARTIFACT_MAX_SIZE_BYTES', config.artifactMaxSizeBytes);
  process.env['CLAUDE_BIN'] = config.claudeBin;
  process.env['CODEX_BIN'] = config.codexBin;
  process.env['OPENCODE_BIN'] = config.opencodeBin;
}

const configProxyHandler: ProxyHandler<CoreConfig> = {
  get(_target, property) {
    return readCoreConfig()[property as keyof CoreConfig];
  },
  has(_target, property) {
    return property in readCoreConfig();
  },
  ownKeys() {
    return Reflect.ownKeys(readCoreConfig());
  },
  getOwnPropertyDescriptor(_target, property) {
    const current = readCoreConfig();
    if (!(property in current)) {
      return undefined;
    }

    return {
      configurable: true,
      enumerable: true,
      value: current[property as keyof CoreConfig],
      writable: false,
    };
  },
};

export const config = new Proxy({} as CoreConfig, configProxyHandler);
