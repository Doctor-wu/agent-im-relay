import { homedir } from 'node:os';
import { join } from 'node:path';

export interface RelayPaths {
  homeDir: string;
  configFile: string;
  stateDir: string;
  stateFile: string;
  artifactsDir: string;
  logsDir: string;
}

export function resolveRelayHomeDir(baseDir: string = homedir()): string {
  return join(baseDir, '.agent-inbox');
}

export function resolveRelayPaths(baseDir: string = homedir()): RelayPaths {
  const homeDir = resolveRelayHomeDir(baseDir);

  return {
    homeDir,
    configFile: join(homeDir, 'config.jsonl'),
    stateDir: join(homeDir, 'state'),
    stateFile: join(homeDir, 'state', 'sessions.json'),
    artifactsDir: join(homeDir, 'artifacts'),
    logsDir: join(homeDir, 'logs'),
  };
}
