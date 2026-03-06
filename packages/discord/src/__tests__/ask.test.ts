import { beforeEach, describe, expect, it, vi } from 'vitest';

const { streamAgentSession, streamAgentToDiscord, prepareAttachmentPrompt } = vi.hoisted(() => ({
  streamAgentSession: vi.fn(),
  streamAgentToDiscord: vi.fn(async () => {}),
  prepareAttachmentPrompt: vi.fn(async ({ prompt }) => ({ prompt, attachments: [] })),
}));

vi.mock('@agent-im-relay/core', async () => {
  const actual = await vi.importActual<typeof import('@agent-im-relay/core')>('@agent-im-relay/core');
  return {
    ...actual,
    streamAgentSession,
  };
});

vi.mock('../stream.js', () => ({
  streamAgentToDiscord,
}));

vi.mock('../files.js', async () => {
  const actual = await vi.importActual<typeof import('../files.js')>('../files.js');
  return {
    ...actual,
    prepareAttachmentPrompt,
  };
});

import { handleAskCommand } from '../commands/ask.js';

describe('handleAskCommand', () => {
  beforeEach(() => {
    prepareAttachmentPrompt.mockReset();
    prepareAttachmentPrompt.mockImplementation(async ({ prompt }) => ({ prompt, attachments: [] }));
    streamAgentSession.mockReset();
    streamAgentSession.mockImplementation(async function* () {
      yield { type: 'done', result: 'done' };
    });
    streamAgentToDiscord.mockClear();
  });

  it('downloads attachments for /ask and passes the prepared prompt into the shared stream runner', async () => {
    const attachment = {
      id: 'att-1',
      name: 'question.md',
      url: 'https://example.com/question.md',
      contentType: 'text/markdown',
      size: 24,
    };
    const channel = {
      isTextBased: () => true,
      send: vi.fn(),
    };
    const initialMessage = { id: 'reply-1' };
    prepareAttachmentPrompt.mockResolvedValue({
      prompt: 'Attached files are available locally for this run:\n- question.md\n\nUser request:\nWhat changed?',
      attachments: [],
    });

    const interaction = {
      id: 'interaction-1',
      channel,
      options: {
        getString: vi.fn().mockReturnValue('What changed?'),
        getAttachment: vi.fn((name: string) => name === 'file' ? attachment : null),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      fetchReply: vi.fn().mockResolvedValue(initialMessage),
    } as any;

    await handleAskCommand(interaction);

    expect(prepareAttachmentPrompt).toHaveBeenCalledWith({
      conversationId: 'ask-interaction-1',
      prompt: 'What changed?',
      attachments: [attachment],
      sourceMessageId: 'interaction-1',
    });
    const sessionOptions = streamAgentSession.mock.calls[0]?.[0];
    expect(sessionOptions).toEqual({
      mode: 'ask',
      prompt: 'Attached files are available locally for this run:\n- question.md\n\nUser request:\nWhat changed?',
    });
    expect(sessionOptions?.prompt).not.toContain('```artifacts');
    expect(streamAgentToDiscord).toHaveBeenCalledWith({
      channel,
      initialMessage,
    }, expect.any(Object));
  });
});
