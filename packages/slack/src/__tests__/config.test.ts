import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readSlackConfig', () => {
  it('reads required Slack config from ~/.agent-inbox/config.jsonl', async () => {
    const homeDir = await mkdtemp('/tmp/agent-inbox-slack-home-');
    const configDir = join(homeDir, '.agent-inbox');
    vi.stubEnv('HOME', homeDir);

    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'config.jsonl'), [
      '{"type":"meta","version":1}',
      '{"type":"im","id":"slack","enabled":true,"config":{"botToken":"xoxb-test-token","appToken":"xapp-test-token","signingSecret":"test-signing-secret","socketMode":false}}',
    ].join('\n'), 'utf-8');

    const { readSlackConfig } = await import('../config.js');
    const config = readSlackConfig();

    expect(config.slackBotToken).toBe('xoxb-test-token');
    expect(config.slackAppToken).toBe('xapp-test-token');
    expect(config.slackSigningSecret).toBe('test-signing-secret');
    expect(config.slackSocketMode).toBe(false);
  });

  it('throws when required Slack config is missing from the shared file', async () => {
    const homeDir = await mkdtemp('/tmp/agent-inbox-slack-home-');
    const configDir = join(homeDir, '.agent-inbox');
    vi.stubEnv('HOME', homeDir);

    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'config.jsonl'), '{"type":"meta","version":1}\n', 'utf-8');

    const { readSlackConfig } = await import('../config.js');

    expect(() => readSlackConfig()).toThrow(
      'Missing required slack configuration in ~/.agent-inbox/config.jsonl',
    );
  });
});

describe('Slack state helpers', () => {
  it('derives Slack-specific sibling state files from the shared state file', async () => {
    const {
      resolveSlackConversationStateFile,
      resolveSlackPendingRunStateFile,
    } = await import('../config.js');

    expect(resolveSlackConversationStateFile('/tmp/agent-inbox/state/sessions.json')).toBe(
      '/tmp/agent-inbox/state/slack-conversations.json',
    );
    expect(resolveSlackPendingRunStateFile('/tmp/agent-inbox/state/sessions.json')).toBe(
      '/tmp/agent-inbox/state/slack-pending-runs.json',
    );
  });
});
