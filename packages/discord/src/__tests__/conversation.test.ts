import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runConversationSession, persistState, streamAgentToDiscord } = vi.hoisted(() => ({
  runConversationSession: vi.fn(),
  persistState: vi.fn(),
  streamAgentToDiscord: vi.fn(async () => {}),
}));

vi.mock('@agent-im-relay/core', async () => {
  const actual = await vi.importActual<typeof import('@agent-im-relay/core')>('@agent-im-relay/core');
  return {
    ...actual,
    runConversationSession,
    persistState,
  };
});

vi.mock('../stream.js', () => ({
  streamAgentToDiscord,
}));

import {
  activeConversations,
  conversationBackend,
  conversationCwd,
  conversationEffort,
  conversationModels,
  conversationSessions,
} from '@agent-im-relay/core';
import { runMentionConversation } from '../conversation.js';

describe('runMentionConversation', () => {
  beforeEach(() => {
    activeConversations.clear();
    conversationBackend.clear();
    conversationCwd.clear();
    conversationEffort.clear();
    conversationModels.clear();
    conversationSessions.clear();
    persistState.mockReset();
    runConversationSession.mockReset();
    streamAgentToDiscord.mockClear();

    runConversationSession.mockImplementation(async function* () {
      yield { type: 'done', result: 'done', sessionId: 'resolved-session' };
    });
  });

  it('shows environment on the first thread run', async () => {
    const thread = { id: 'thread-1' } as any;

    const started = await runMentionConversation(thread, 'hello');

    expect(started).toBe(true);
    expect(streamAgentToDiscord).toHaveBeenCalledWith(
      { channel: thread, showEnvironment: true },
      expect.any(Object),
    );
  });

  it('skips environment after a session already exists', async () => {
    const thread = { id: 'thread-2' } as any;
    conversationSessions.set(thread.id, 'existing-session');

    const started = await runMentionConversation(thread, 'hello again');

    expect(started).toBe(true);
    expect(streamAgentToDiscord).toHaveBeenCalledWith(
      { channel: thread, showEnvironment: false },
      expect.any(Object),
    );
  });
});
