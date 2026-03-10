import { ChannelType } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { askCommand } from '../commands/ask.js';
import { codeCommand } from '../commands/code.js';
import { doneCommand } from '../commands/done.js';
import {
  compactCommand,
  effortCommand,
  sessionsCommand,
} from '../commands/agent-control.js';
import { skillCommand } from '../commands/skill.js';
import { ensureCodeThread, ensureMentionThread } from '../thread.js';

describe('discord copy', () => {
  it('uses Agent wording in user-facing command descriptions', () => {
    expect(askCommand.toJSON().description).toBe('Ask Agent a quick question without file tools');
    expect(codeCommand.toJSON().options?.[0]?.description).toBe('What should Agent build or fix?');
    expect(doneCommand.toJSON().description).toBe('End the current agent session in this thread');
    expect(skillCommand.toJSON().description).toBe('Run agent with an installed skill in this thread');
    expect(effortCommand.toJSON().description).toBe('Set agent effort for this thread');
    expect(sessionsCommand.toJSON().description).toBe('List active agent sessions');
    expect(compactCommand.toJSON().description).toBe('Ask agent to summarize this thread context briefly');
  });

  it('uses Agent wording when creating /code threads', async () => {
    const startThread = vi.fn(async () => ({ id: 'thread-1' }));
    const send = vi.fn(async () => ({ startThread }));
    const interaction = {
      user: { id: 'user-1', tag: 'doctorwu#0001' },
      channel: {
        isThread: () => false,
        type: ChannelType.GuildText,
        send,
      },
    } as any;

    await ensureCodeThread(interaction, 'Fix copy');

    expect(send).toHaveBeenCalledWith('🧵 Starting /code task for <@user-1>');
    expect(startThread).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'Agent code task started by doctorwu#0001',
    }));
  });

  it('uses Agent wording when creating mention threads', async () => {
    const startThread = vi.fn(async () => ({ id: 'thread-2' }));
    const send = vi.fn(async () => ({ startThread }));
    const message = {
      author: { tag: 'doctorwu#0001' },
      channel: {
        isThread: () => false,
        type: ChannelType.GuildText,
        send,
      },
    } as any;

    await ensureMentionThread(message, 'Fix copy');

    expect(send).toHaveBeenCalledWith('🧵 Starting Agent session...');
    expect(startThread).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'Agent mention started by doctorwu#0001',
    }));
  });
});
