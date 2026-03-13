import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(async () => {
  const { resetSlackStateForTests } = await import('../state.js');
  resetSlackStateForTests();
});

describe('Slack conversation helpers', () => {
  it('resolves mapped conversation ids only for active Slack threads', async () => {
    const {
      buildSlackConversationId,
      resolveSlackConversationIdForMessage,
      shouldProcessSlackMessage,
    } = await import('../conversation.js');
    const { rememberSlackConversation } = await import('../state.js');

    rememberSlackConversation({
      conversationId: '1741766400.123456',
      channelId: 'C123',
      threadTs: buildSlackConversationId('1741766400.123456'),
      rootMessageTs: '1741766400.123456',
    });

    expect(resolveSlackConversationIdForMessage({
      channel: 'C123',
      ts: '1741766401.000001',
      thread_ts: '1741766400.123456',
      user: 'U123',
      text: 'continue',
    })).toBe('1741766400.123456');

    expect(shouldProcessSlackMessage({
      channel: 'C123',
      ts: '1741766401.000001',
      thread_ts: '1741766400.123456',
      user: 'U123',
      text: 'continue',
    })).toBe(true);

    expect(shouldProcessSlackMessage({
      channel: 'C123',
      ts: '1741766402.000001',
      user: 'U123',
      text: 'ignore channel message',
    })).toBe(false);

    expect(shouldProcessSlackMessage({
      channel: 'C123',
      ts: '1741766403.000001',
      thread_ts: '1741766400.123456',
      bot_id: 'B123',
      text: 'bot reply',
    })).toBe(false);

    expect(shouldProcessSlackMessage({
      channel: 'D123',
      channel_type: 'im',
      ts: '1741766404.000001',
      user: 'U123',
      text: 'start dm session',
    })).toBe(true);
  });

  it('persists and reloads Slack conversation mappings', async () => {
    const tempDir = await mkdtemp('/tmp/slack-state-');
    const stateFile = join(tempDir, 'slack-conversations.json');
    const {
      getSlackConversation,
      loadSlackConversationState,
      persistSlackConversationState,
      rememberSlackConversation,
      resetSlackStateForTests,
    } = await import('../state.js');

    rememberSlackConversation({
      conversationId: '1741766400.123456',
      channelId: 'C123',
      threadTs: '1741766400.123456',
      rootMessageTs: '1741766400.123456',
    });

    await persistSlackConversationState(stateFile);
    expect(JSON.parse(await readFile(stateFile, 'utf-8'))).toEqual({
      conversations: {
        '1741766400.123456': {
          channelId: 'C123',
          threadTs: '1741766400.123456',
          rootMessageTs: '1741766400.123456',
        },
      },
    });

    resetSlackStateForTests();
    await loadSlackConversationState(stateFile);

    expect(getSlackConversation('1741766400.123456')).toMatchObject({
      channelId: 'C123',
      threadTs: '1741766400.123456',
      rootMessageTs: '1741766400.123456',
    });
  });
});
