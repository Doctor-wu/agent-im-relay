import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runConversationWithRenderer, persistState, streamAgentToDiscord, prepareAttachmentPrompt } = vi.hoisted(() => ({
  runConversationWithRenderer: vi.fn(async (options) => {
    const prepared = await options.preparePrompt?.({
      conversationId: options.conversationId,
      prompt: options.prompt,
      sourceMessageId: options.sourceMessageId,
    });

    await options.render(
      { target: options.target, showEnvironment: !options.sourceMessageId },
      (async function* () {
        if (prepared?.prompt) {
          yield { type: 'status', status: prepared.prompt };
        }
        yield { type: 'done', result: 'done', sessionId: 'resolved-session' };
      })(),
    );

    return true;
  }),
  persistState: vi.fn(),
  streamAgentToDiscord: vi.fn(async () => {}),
  prepareAttachmentPrompt: vi.fn(async ({ prompt }) => ({ prompt, attachments: [] })),
}));

vi.mock('@agent-im-relay/core', async () => {
  const actual = await vi.importActual<typeof import('@agent-im-relay/core')>('@agent-im-relay/core');
  return {
    ...actual,
    runConversationWithRenderer,
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
    runConversationWithRenderer.mockClear();
    prepareAttachmentPrompt.mockReset();
    streamAgentToDiscord.mockReset();
    prepareAttachmentPrompt.mockImplementation(async ({ prompt }) => ({ prompt, attachments: [] }));
    runConversationWithRenderer.mockImplementation(async (options) => {
      const prepared = await options.preparePrompt?.({
        conversationId: options.conversationId,
        prompt: options.prompt,
        sourceMessageId: options.sourceMessageId,
      });

      await options.render(
        {
          target: options.target,
          showEnvironment: !conversationSessions.has(options.conversationId),
        },
        (async function* () {
          if (prepared?.prompt) {
            yield { type: 'status', status: prepared.prompt };
          }
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
    expect(runConversationWithRenderer).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: thread.id,
      target: thread,
      prompt: 'hello',
    }));
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
    const runnerOptions = runConversationWithRenderer.mock.calls[0]?.[0];
    const prepared = await runnerOptions.preparePrompt({
      conversationId: thread.id,
      prompt: 'hello',
      sourceMessageId: 'msg-1',
    });
    expect(prepared.prompt).toContain('spec.md');
    expect(prepared.prompt).toContain('/tmp/thread-attachments/incoming/spec.md');
    expect(prepared.prompt).toContain('preview: # Spec');
  });

  it('skips environment after a session already exists', async () => {
    const thread = { id: 'thread-2' } as any;
    conversationSessions.set(thread.id, 'existing-session');

    const started = await runMentionConversation(thread, 'hello again');

    expect(started).toBe(true);
    expect(runConversationWithRenderer).toHaveBeenCalledWith(expect.objectContaining({
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
    const runnerOptions = runConversationWithRenderer.mock.calls[0]?.[0];
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
