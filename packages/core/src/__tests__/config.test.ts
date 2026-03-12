import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('core config', () => {
  it('does not expose relay-level model config', async () => {
    vi.stubEnv('CLAUDE_MODEL', 'sonnet');

    const { readCoreConfig } = await import('../config.js');
    const config = readCoreConfig(process.env);

    expect('claudeModel' in config).toBe(false);
  });

  it('reflects environment overrides even after the module is imported', async () => {
    const { config } = await import('../config.js');

    vi.stubEnv('STATE_FILE', '/tmp/agent-inbox-state-a.json');
    expect(config.stateFile).toBe('/tmp/agent-inbox-state-a.json');

    vi.stubEnv('STATE_FILE', '/tmp/agent-inbox-state-b.json');
    expect(config.stateFile).toBe('/tmp/agent-inbox-state-b.json');
  });

  it('defaults to a HOME-scoped relay directory when HOME is writable', async () => {
    const homeDir = await mkdtemp('/tmp/agent-inbox-home-');
    vi.stubEnv('HOME', homeDir);
    vi.stubEnv('INIT_CWD', '');
    const env = {
      ...process.env,
    };
    delete env.STATE_FILE;
    delete env.ARTIFACTS_BASE_DIR;

    const { readCoreConfig } = await import('../config.js');
    const config = readCoreConfig(env);

    expect(config.stateFile).toBe(join(homeDir, '.agent-inbox', 'state', 'sessions.json'));
    expect(config.artifactsBaseDir).toBe(join(homeDir, '.agent-inbox', 'artifacts'));
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

  it('prefers INIT_CWD over process.cwd when HOME is unavailable', async () => {
    const initCwd = await mkdtemp('/tmp/agent-inbox-init-cwd-');
    vi.stubEnv('HOME', '/definitely/missing-home');
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

  it('resolves platform-specific state directories for Slack', async () => {
    const baseDir = await mkdtemp('/tmp/agent-inbox-platform-state-');
    const { resolveRelayPlatformStateDir } = await import('../paths.js');

    expect(resolveRelayPlatformStateDir('slack', baseDir)).toBe(
      join(baseDir, '.agent-inbox', 'state', 'slack'),
    );
  });
});

describe('relay platform inference', () => {
  it('recognizes Slack thread timestamps as Slack conversations', async () => {
    const { inferRelayPlatformFromConversationId, relayPlatforms } = await import('../relay-platform.js');

    expect(relayPlatforms).toContain('slack');
    expect(inferRelayPlatformFromConversationId('1741766400.123456')).toBe('slack');
    expect(inferRelayPlatformFromConversationId('123456789012345678')).toBe('discord');
    expect(inferRelayPlatformFromConversationId('oc_platform_only')).toBe('feishu');
  });
});
