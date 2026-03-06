import { describe, expect, it, vi, beforeEach } from 'vitest';

const { ensureCodeThread, runMentionConversation } = vi.hoisted(() => ({
  ensureCodeThread: vi.fn(),
  runMentionConversation: vi.fn(),
}));

vi.mock('../thread.js', () => ({
  ensureCodeThread,
}));

vi.mock('../conversation.js', () => ({
  runMentionConversation,
}));

import { handleCodeCommand } from '../commands/code.js';

describe('handleCodeCommand', () => {
  beforeEach(() => {
    ensureCodeThread.mockReset();
    runMentionConversation.mockReset();
  });

  it('routes /code through the shared conversation runner', async () => {
    const attachment = {
      id: 'att-1',
      name: 'spec.md',
      url: 'https://example.com/spec.md',
      contentType: 'text/markdown',
      size: 12,
    };
    const thread = {
      toString: () => '<#thread-1>',
      send: vi.fn().mockResolvedValue(undefined),
    };
    ensureCodeThread.mockResolvedValue(thread);
    runMentionConversation.mockResolvedValue(true);

    const interaction = {
      options: {
        getString: vi.fn().mockReturnValue('Ship the feature'),
        getAttachment: vi.fn((name: string) => name === 'file' ? attachment : null),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as any;

    await handleCodeCommand(interaction);

    expect(ensureCodeThread).toHaveBeenCalledWith(interaction, 'Ship the feature');
    expect(thread.send).toHaveBeenCalledWith('## /code\nShip the feature');
    expect(runMentionConversation).toHaveBeenCalledWith(thread, 'Ship the feature', undefined, {
      attachments: [attachment],
    });
    expect(interaction.editReply).toHaveBeenNthCalledWith(1, 'Started coding in <#thread-1>');
  });

  it('reports a busy thread when a run is already active', async () => {
    const thread = {
      toString: () => '<#thread-2>',
      send: vi.fn().mockResolvedValue(undefined),
    };
    ensureCodeThread.mockResolvedValue(thread);
    runMentionConversation.mockResolvedValue(false);

    const interaction = {
      options: {
        getString: vi.fn().mockReturnValue('Retry later'),
        getAttachment: vi.fn().mockReturnValue(null),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as any;

    await handleCodeCommand(interaction);

    expect(runMentionConversation).toHaveBeenCalledWith(thread, 'Retry later', undefined, {
      attachments: [],
    });
    expect(interaction.editReply).toHaveBeenNthCalledWith(2, 'Claude is already busy in <#thread-2>');
  });
});
