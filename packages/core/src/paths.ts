import { accessSync, constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RelayPlatform } from './relay-platform.js';

export interface RelayPaths {
  homeDir: string;
  configFile: string;
  stateDir: string;
  stateFile: string;
  artifactsDir: string;
  logsDir: string;
  pidsDir: string;
}

function canWriteDirectory(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveDefaultRelayBaseDir(): string {
  const homeDir = process.env['HOME']?.trim() || homedir();
  if (homeDir && canWriteDirectory(homeDir)) {
    return homeDir;
  }

  const initCwd = process.env['INIT_CWD']?.trim();
  const candidates = [initCwd, process.cwd(), tmpdir()];

  for (const candidate of candidates) {
    if (candidate && canWriteDirectory(candidate)) {
      return candidate;
    }
  }

  return process.cwd();
}

export function resolveRelayHomeDir(baseDir: string = resolveDefaultRelayBaseDir()): string {
  return join(baseDir, '.agent-inbox');
}

export function resolveRelayPaths(baseDir: string = resolveDefaultRelayBaseDir()): RelayPaths {
  const homeDir = resolveRelayHomeDir(baseDir);

  return {
    homeDir,
    configFile: join(homeDir, 'config.jsonl'),
    stateDir: join(homeDir, 'state'),
    stateFile: join(homeDir, 'state', 'sessions.json'),
    artifactsDir: join(homeDir, 'artifacts'),
    logsDir: join(homeDir, 'logs'),
    pidsDir: join(homeDir, 'pids'),
  };
}

export function resolveRelayPlatformStateDir(
  platform: RelayPlatform,
  baseDir: string = resolveDefaultRelayBaseDir(),
): string {
  return join(resolveRelayPaths(baseDir).stateDir, platform);
}
