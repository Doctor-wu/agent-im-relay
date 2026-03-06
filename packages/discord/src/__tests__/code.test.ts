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
    const thread = {
      toString: () => '<#thread-1>',
      send: vi.fn().mockResolvedValue(undefined),
    };
    ensureCodeThread.mockResolvedValue(thread);
    runMentionConversation.mockResolvedValue(true);

    const interaction = {
      options: {
        getString: vi.fn().mockReturnValue('Ship the feature'),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as any;

    await handleCodeCommand(interaction);

    expect(ensureCodeThread).toHaveBeenCalledWith(interaction, 'Ship the feature');
    expect(thread.send).toHaveBeenCalledWith('## /code\nShip the feature');
    expect(runMentionConversation).toHaveBeenCalledWith(thread, 'Ship the feature');
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
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as any;

    await handleCodeCommand(interaction);

    expect(runMentionConversation).toHaveBeenCalledWith(thread, 'Retry later');
    expect(interaction.editReply).toHaveBeenNthCalledWith(2, 'Claude is already busy in <#thread-2>');
  });
});
