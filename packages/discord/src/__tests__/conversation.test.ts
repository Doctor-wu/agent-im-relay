import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runPlatformConversation, persistState, streamAgentToDiscord, publishConversationArtifacts } = vi.hoisted(() => ({
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
  publishConversationArtifacts: vi.fn(async () => {}),
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

vi.mock('../artifacts.js', () => ({
  publishConversationArtifacts,
}));

import {
  activeConversations,
  conversationBackend,
  conversationCwd,
  conversationEffort,
  conversationModels,
  closeThreadSession,
  openThreadSessionBinding,
  threadSessionBindings,
} from '@agent-im-relay/core';
import { hasOpenStickyThreadSession, runMentionConversation } from '../conversation.js';

describe('runMentionConversation', () => {
  beforeEach(() => {
    activeConversations.clear();
    conversationBackend.clear();
    conversationCwd.clear();
    conversationEffort.clear();
    conversationModels.clear();
    threadSessionBindings.clear();
    persistState.mockReset();
    runPlatformConversation.mockClear();
    streamAgentToDiscord.mockReset();
    publishConversationArtifacts.mockReset();
    runPlatformConversation.mockImplementation(async (options) => {
      await options.render(
        {
          target: options.target,
          showEnvironment: !options.sourceMessageId && !threadSessionBindings.has(options.conversationId),
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

  it('skips environment after a sticky thread binding already exists', async () => {
    const thread = { id: 'thread-2' } as any;
    openThreadSessionBinding({
      conversationId: thread.id,
      backend: 'claude',
      now: '2026-03-07T00:00:00.000Z',
    });

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

  it('treats a thread as active when a sticky binding exists, and only /done resets it', async () => {
    openThreadSessionBinding({
      conversationId: 'thread-sticky',
      backend: 'claude',
      now: '2026-03-07T00:00:00.000Z',
    });

    expect(hasOpenStickyThreadSession('thread-sticky')).toBe(true);

    closeThreadSession({ conversationId: 'thread-sticky' });

    expect(hasOpenStickyThreadSession('thread-sticky')).toBe(false);
  });

  it('passes reply context into stream rendering and artifact publishing', async () => {
    const thread = { id: 'thread-bot-trigger' } as any;
    const triggerMsg = { id: 'msg-bot-trigger' } as any;
    const replyContext = { mentionUserId: 'other-bot' };

    const started = await runMentionConversation(thread, 'hello', triggerMsg, { replyContext });

    expect(started).toBe(true);
    expect(streamAgentToDiscord).toHaveBeenCalledWith(
      {
        channel: thread,
        showEnvironment: false,
        replyContext,
      },
      expect.any(Object),
    );

    const runnerOptions = runPlatformConversation.mock.calls[0]?.[0];
    await runnerOptions.publishArtifacts({
      conversationId: thread.id,
      cwd: '/tmp/workspace',
      files: ['summary.md'],
      warnings: ['warn'],
      sourceMessageId: 'msg-bot-trigger',
      target: thread,
    });

    expect(publishConversationArtifacts).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: thread.id,
      channel: thread,
      sourceMessageId: 'msg-bot-trigger',
      replyContext,
    }));
  });
});
