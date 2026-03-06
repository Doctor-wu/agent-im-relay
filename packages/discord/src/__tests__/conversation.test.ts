import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runConversationSession, persistState, streamAgentToDiscord, prepareAttachmentPrompt } = vi.hoisted(() => ({
  runConversationSession: vi.fn(),
  persistState: vi.fn(),
  streamAgentToDiscord: vi.fn(async () => {}),
  prepareAttachmentPrompt: vi.fn(async ({ prompt }) => ({ prompt, attachments: [] })),
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

vi.mock('../files.js', () => ({
  prepareAttachmentPrompt,
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
    prepareAttachmentPrompt.mockReset();
    runConversationSession.mockReset();
    streamAgentToDiscord.mockClear();
    prepareAttachmentPrompt.mockImplementation(async ({ prompt }) => ({ prompt, attachments: [] }));

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

  it('prepares attachment context before starting the agent run', async () => {
    const thread = { id: 'thread-attachments' } as any;
    const attachments = [
      {
        id: 'att-1',
        name: 'spec.md',
        url: 'https://example.com/spec.md',
        contentType: 'text/markdown',
        size: 12,
      },
    ];
    prepareAttachmentPrompt.mockResolvedValue({
      prompt: [
        'Attached files are available locally for this run:',
        '- spec.md | markdown, 12 B | text/markdown',
        '  path: /tmp/thread-attachments/incoming/spec.md',
        '  preview: # Spec',
        '',
        'User request:',
        'hello',
      ].join('\n'),
      attachments: [],
    });

    const started = await runMentionConversation(thread, 'hello', { id: 'msg-1' } as any, { attachments });

    expect(started).toBe(true);
    expect(prepareAttachmentPrompt).toHaveBeenCalledWith({
      conversationId: thread.id,
      prompt: 'hello',
      attachments,
      sourceMessageId: 'msg-1',
    });
    expect(runConversationSession).toHaveBeenCalledWith(thread.id, expect.objectContaining({
      prompt: expect.stringContaining('spec.md'),
    }));
    expect(runConversationSession).toHaveBeenCalledWith(thread.id, expect.objectContaining({
      prompt: expect.stringContaining('/tmp/thread-attachments/incoming/spec.md'),
    }));
    expect(runConversationSession).toHaveBeenCalledWith(thread.id, expect.objectContaining({
      prompt: expect.stringContaining('preview: # Spec'),
    }));
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
