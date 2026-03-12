import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readSlackConfig', () => {
  it('parses required Slack environment variables and defaults', async () => {
    const { readSlackConfig } = await import('../config.js');
    const config = readSlackConfig({
      ...process.env,
      SLACK_BOT_TOKEN: 'xoxb-test-token',
      SLACK_APP_TOKEN: 'xapp-test-token',
      SLACK_SIGNING_SECRET: 'test-signing-secret',
    });

    expect(config.slackBotToken).toBe('xoxb-test-token');
    expect(config.slackAppToken).toBe('xapp-test-token');
    expect(config.slackSigningSecret).toBe('test-signing-secret');
    expect(config.slackSocketMode).toBe(true);
  });

  it('throws when required Slack environment variables are missing', async () => {
    const { readSlackConfig } = await import('../config.js');

    expect(() => readSlackConfig({
      ...process.env,
      SLACK_BOT_TOKEN: '',
      SLACK_APP_TOKEN: '',
      SLACK_SIGNING_SECRET: '',
    })).toThrow('Missing required environment variable: SLACK_BOT_TOKEN');
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
