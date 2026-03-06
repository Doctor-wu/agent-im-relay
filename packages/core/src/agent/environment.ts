import { spawnSync } from 'node:child_process';
import type { BackendName } from './backend.js';
import type { AgentEnvironment, AgentSessionOptions } from './session.js';

function readGitOutput(cwd: string, args: string[]): string | undefined {
  try {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    if (result.status !== 0) {
      return undefined;
    }

    const value = result.stdout.trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

export function detectGitContext(cwd: string): AgentEnvironment['git'] {
  const repoRoot = readGitOutput(cwd, ['rev-parse', '--show-toplevel']);
  if (!repoRoot) {
    return { isRepo: false };
  }

  return {
    isRepo: true,
    repoRoot,
    branch: readGitOutput(cwd, ['branch', '--show-current']),
  };
}

export function buildEnvironment(
  backend: BackendName,
  options: AgentSessionOptions,
  cwd: string | undefined,
  source: AgentEnvironment['cwd']['source'],
  resolvedModel?: string,
): AgentEnvironment {
  return {
    backend,
    mode: options.mode,
    model: {
      requested: options.model,
      resolved: resolvedModel,
    },
    cwd: {
      value: cwd,
      source,
    },
    git: cwd ? detectGitContext(cwd) : { isRepo: false },
  };
}
