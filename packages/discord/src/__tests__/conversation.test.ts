import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runPlatformConversation, persistState, streamAgentToDiscord } = vi.hoisted(() => ({
  runPlatformConversation: vi.fn(async (options) => {
    await options.render(
      { target: options.target, showEnvironment: !options.sourceMessageId },
      (async function* () {
        yield { type: 'done', result: 'done', sessionId: 'resolved-session' };
      })(),
    );

    return true;
  }),
  persistState: vi.fn(),
  streamAgentToDiscord: vi.fn(async () => {}),
}));

vi.mock('@agent-im-relay/core', async () => {
  const actual = await vi.importActual<typeof import('@agent-im-relay/core')>('@agent-im-relay/core');
  return {
    ...actual,
    runPlatformConversation,
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
    runPlatformConversation.mockClear();
    streamAgentToDiscord.mockReset();
    runPlatformConversation.mockImplementation(async (options) => {
      await options.render(
        {
          target: options.target,
          showEnvironment: !conversationSessions.has(options.conversationId),
        },
        (async function* () {
          yield { type: 'done', result: 'done', sessionId: 'resolved-session' };
        })(),
      );

      return true;
    });
    streamAgentToDiscord.mockImplementation(async (_options, events) => {
      for await (const _event of events) {
        // Drain the stream to trigger conversation side effects.
      }
    });
  });

  it('shows environment on the first thread run', async () => {
    const thread = { id: 'thread-1' } as any;

    const started = await runMentionConversation(thread, 'hello');

    expect(started).toBe(true);
    expect(runPlatformConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: thread.id,
      target: thread,
      prompt: 'hello',
    }));
    expect(streamAgentToDiscord).toHaveBeenCalledWith(
      { channel: thread, showEnvironment: true },
      expect.any(Object),
    );
  });

  it('passes shared attachment metadata into the new core wrapper', async () => {
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

    const started = await runMentionConversation(thread, 'hello', { id: 'msg-1' } as any, { attachments });

    expect(started).toBe(true);
    const runnerOptions = runPlatformConversation.mock.calls[0]?.[0];
    expect(runnerOptions.attachments).toEqual(attachments);
  });

  it('skips environment after a session already exists', async () => {
    const thread = { id: 'thread-2' } as any;
    conversationSessions.set(thread.id, 'existing-session');

    const started = await runMentionConversation(thread, 'hello again');

    expect(started).toBe(true);
    expect(runPlatformConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: thread.id,
      prompt: 'hello again',
    }));
    expect(streamAgentToDiscord).toHaveBeenCalledWith(
      { channel: thread, showEnvironment: false },
      expect.any(Object),
    );
  });

  it('passes backend state and reaction handlers into the extracted runner wrapper', async () => {
    const thread = { id: 'thread-regression' } as any;
    const triggerMsg = { id: 'msg-regression' } as any;
    const setReaction = vi.fn(async () => {});
    conversationBackend.set(thread.id, 'codex');
    const started = await runMentionConversation(thread, 'hello', triggerMsg, { setReaction });

    expect(started).toBe(true);
    const runnerOptions = runPlatformConversation.mock.calls[0]?.[0];
    expect(runnerOptions).toEqual(expect.objectContaining({
      conversationId: thread.id,
      target: thread,
      sourceMessageId: 'msg-regression',
      backend: 'codex',
    }));
    await runnerOptions.onPhaseChange('tools', 'thinking', triggerMsg);
    await runnerOptions.onPhaseChange('done', 'tools', triggerMsg);
    expect(setReaction).toHaveBeenNthCalledWith(1, triggerMsg, 'thinking', 'received');
    expect(setReaction).toHaveBeenNthCalledWith(2, triggerMsg, 'tools', 'thinking');
    expect(setReaction).toHaveBeenNthCalledWith(3, triggerMsg, 'done', 'tools');
  });
});
