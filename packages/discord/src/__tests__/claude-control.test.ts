import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationCwd } from '@agent-im-relay/core';
import { claudeControlCommandHandlers, claudeControlCommands } from '../commands/claude-control.js';

beforeEach(() => {
  conversationCwd.clear();
});

describe('claudeControlCommands', () => {
  it('registers cwd and omits removed legacy session commands', () => {
    const commandNames = claudeControlCommands.map((command) => command.toJSON().name);

    expect(commandNames).toContain('cwd');
    expect(commandNames).not.toContain('resume');
    expect(commandNames).not.toContain('clear');
    expect(claudeControlCommandHandlers.has('cwd')).toBe(true);
    expect(claudeControlCommandHandlers.has('resume')).toBe(false);
    expect(claudeControlCommandHandlers.has('clear')).toBe(false);
  });

  it('sets, shows, and clears cwd overrides for the current thread', async () => {
    const handler = claudeControlCommandHandlers.get('cwd');
    expect(handler).toBeDefined();

    const replies: string[] = [];
    const interaction = {
      channel: { id: 'thread-123', isThread: () => true },
      options: {
        getSubcommand: vi.fn().mockReturnValue('set'),
        getString: vi.fn().mockReturnValue('/tmp/project'),
      },
      reply: vi.fn(async ({ content }: { content: string }) => {
        replies.push(content);
      }),
    } as any;

    await handler?.(interaction);
    expect(conversationCwd.get('thread-123')).toBe('/tmp/project');

    interaction.options.getSubcommand.mockReturnValue('show');
    await handler?.(interaction);
    expect(replies.at(-1)).toContain('/tmp/project');

    interaction.options.getSubcommand.mockReturnValue('clear');
    await handler?.(interaction);
    expect(conversationCwd.has('thread-123')).toBe(false);
  });
});
