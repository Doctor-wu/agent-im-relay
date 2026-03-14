import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
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
    const config = readCoreConfig();

    expect('claudeModel' in config).toBe(false);
  });

  it('defaults to a HOME-scoped relay directory when HOME is writable', async () => {
    const homeDir = await mkdtemp('/tmp/agent-inbox-home-');
    vi.stubEnv('HOME', homeDir);
    vi.stubEnv('INIT_CWD', '');

    const { readCoreConfig } = await import('../config.js');
    const config = readCoreConfig(homeDir);

    expect(config.stateFile).toBe(join(homeDir, '.agent-inbox', 'state', 'sessions.json'));
    expect(config.artifactsBaseDir).toBe(join(homeDir, '.agent-inbox', 'artifacts'));
  });

  it('falls back to a writable cwd-scoped relay directory when HOME is unavailable', async () => {
    vi.stubEnv('HOME', '/definitely/missing-home');
    vi.stubEnv('INIT_CWD', '');

    const { readCoreConfig } = await import('../config.js');
    const config = readCoreConfig(process.cwd());

    expect(config.stateFile).toBe(join(process.cwd(), '.agent-inbox', 'state', 'sessions.json'));
    expect(config.artifactsBaseDir).toBe(join(process.cwd(), '.agent-inbox', 'artifacts'));
  });

  it('prefers INIT_CWD over process.cwd when HOME is unavailable', async () => {
    const initCwd = await mkdtemp('/tmp/agent-inbox-init-cwd-');
    vi.stubEnv('HOME', '/definitely/missing-home');
    vi.stubEnv('INIT_CWD', initCwd);

    const { readCoreConfig } = await import('../config.js');
    const config = readCoreConfig(initCwd);

    expect(config.stateFile).toBe(join(initCwd, '.agent-inbox', 'state', 'sessions.json'));
    expect(config.artifactsBaseDir).toBe(join(initCwd, '.agent-inbox', 'artifacts'));
  });

  it('reads runtime settings and platform records from ~/.agent-inbox/config.jsonl', async () => {
    const homeDir = await mkdtemp('/tmp/agent-inbox-config-home-');
    const configDir = join(homeDir, '.agent-inbox');
    vi.stubEnv('HOME', homeDir);
    vi.stubEnv('INIT_CWD', '');

    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'config.jsonl'), [
      '{"type":"meta","version":1}',
      '{"type":"runtime","config":{"agentTimeoutMs":1234,"artifactRetentionDays":21,"artifactMaxSizeBytes":4096,"streamUpdateIntervalMs":750,"discordMessageCharLimit":1800,"claudeCwd":"/tmp/relay-workspace","claudeBin":"/tmp/bin/claude","codexBin":"/tmp/bin/codex","opencodeBin":"/tmp/bin/opencode"}}',
      '{"type":"im","id":"discord","enabled":true,"config":{"token":"discord-token","clientId":"discord-client","guildIds":["guild-1"],"allowedChannelIds":["channel-1"]}}',
      '{"type":"im","id":"feishu","enabled":true,"config":{"appId":"feishu-app","appSecret":"feishu-secret","baseUrl":"https://feishu.example.invalid","modelSelectionTimeoutMs":2500}}',
      '{"type":"im","id":"slack","enabled":true,"config":{"botToken":"xoxb-token","appToken":"xapp-token","signingSecret":"signing-secret","socketMode":false}}',
    ].join('\n'), 'utf-8');

    const {
      readCoreConfig,
      readRelayConfig,
      readDiscordRelayConfig,
      readFeishuRelayConfig,
      readSlackRelayConfig,
    } = await import('../config.js');

    const loaded = readRelayConfig(homeDir);
    const coreConfig = readCoreConfig(homeDir);
    const discordConfig = readDiscordRelayConfig(homeDir);
    const feishuConfig = readFeishuRelayConfig(homeDir);
    const slackConfig = readSlackRelayConfig(homeDir);

    expect(loaded.availableIms.map(im => im.id)).toEqual(['discord', 'feishu', 'slack']);
    expect(coreConfig).toMatchObject({
      agentTimeoutMs: 1234,
      artifactRetentionDays: 21,
      artifactMaxSizeBytes: 4096,
      claudeCwd: '/tmp/relay-workspace',
      claudeBin: '/tmp/bin/claude',
      codexBin: '/tmp/bin/codex',
      opencodeBin: '/tmp/bin/opencode',
      stateFile: join(homeDir, '.agent-inbox', 'state', 'sessions.json'),
      artifactsBaseDir: join(homeDir, '.agent-inbox', 'artifacts'),
    });
    expect(discordConfig).toMatchObject({
      discordToken: 'discord-token',
      discordClientId: 'discord-client',
      guildIds: ['guild-1'],
      allowedChannelIds: ['channel-1'],
      streamUpdateIntervalMs: 750,
      discordMessageCharLimit: 1800,
    });
    expect(feishuConfig).toMatchObject({
      feishuAppId: 'feishu-app',
      feishuAppSecret: 'feishu-secret',
      feishuBaseUrl: 'https://feishu.example.invalid',
      feishuModelSelectionTimeoutMs: 2500,
    });
    expect(slackConfig).toMatchObject({
      slackBotToken: 'xoxb-token',
      slackAppToken: 'xapp-token',
      slackSigningSecret: 'signing-secret',
      slackSocketMode: false,
    });
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
