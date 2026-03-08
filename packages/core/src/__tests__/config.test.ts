import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('core config', () => {
  it('reflects environment overrides even after the module is imported', async () => {
    const { config } = await import('../config.js');

    vi.stubEnv('STATE_FILE', '/tmp/agent-inbox-state-a.json');
    expect(config.stateFile).toBe('/tmp/agent-inbox-state-a.json');

    vi.stubEnv('STATE_FILE', '/tmp/agent-inbox-state-b.json');
    expect(config.stateFile).toBe('/tmp/agent-inbox-state-b.json');
  });

  it('falls back to a writable cwd-scoped relay directory when HOME is unavailable', async () => {
    vi.stubEnv('HOME', '/definitely/missing-home');
    vi.stubEnv('INIT_CWD', '');
    const env = {
      ...process.env,
    };
    delete env.STATE_FILE;
    delete env.ARTIFACTS_BASE_DIR;

    const { readCoreConfig } = await import('../config.js');
    const config = readCoreConfig(env);

    expect(config.stateFile).toBe(join(process.cwd(), '.agent-inbox', 'state', 'sessions.json'));
    expect(config.artifactsBaseDir).toBe(join(process.cwd(), '.agent-inbox', 'artifacts'));
  });

  it('prefers INIT_CWD when pnpm launches package-local scripts from a workspace root', async () => {
    const initCwd = await mkdtemp('/tmp/agent-inbox-init-cwd-');
    vi.stubEnv('INIT_CWD', initCwd);
    const env = {
      ...process.env,
    };
    delete env.STATE_FILE;
    delete env.ARTIFACTS_BASE_DIR;

    const { readCoreConfig } = await import('../config.js');
    const config = readCoreConfig(env);

    expect(config.stateFile).toBe(join(initCwd, '.agent-inbox', 'state', 'sessions.json'));
    expect(config.artifactsBaseDir).toBe(join(initCwd, '.agent-inbox', 'artifacts'));
  });
});
