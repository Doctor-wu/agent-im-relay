import { config as dotenvConfig } from 'dotenv';
import { join, resolve } from 'node:path';

dotenvConfig({ path: resolve(import.meta.dirname, '../../../.env') });

function numberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric environment variable: ${key}`);
  }

  return parsed;
}

export const config = {
  agentTimeoutMs: numberEnv('AGENT_TIMEOUT_MS', 10 * 60 * 1000),
  claudeModel: process.env['CLAUDE_MODEL'],
  claudeCwd: process.env['CLAUDE_CWD']?.trim() || process.cwd(),
  stateFile: process.env['STATE_FILE']?.trim() || join(process.cwd(), 'data', 'sessions.json'),
  artifactsBaseDir: process.env['ARTIFACTS_BASE_DIR']?.trim() || join(process.cwd(), 'data', 'artifacts'),
  artifactRetentionDays: numberEnv('ARTIFACT_RETENTION_DAYS', 14),
  artifactMaxSizeBytes: numberEnv('ARTIFACT_MAX_SIZE_BYTES', 8 * 1024 * 1024),
  claudeBin: process.env['CLAUDE_BIN']?.trim() || '/opt/homebrew/bin/claude',
  codexBin: process.env['CODEX_BIN']?.trim() || '/opt/homebrew/bin/codex',
};
