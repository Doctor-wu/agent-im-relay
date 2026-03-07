import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '@agent-im-relay/core';
import * as streamModule from '../stream.js';
import { claudeControlCommandHandlers, claudeControlCommands } from '../commands/claude-control.js';

beforeEach(() => {
  core.activeConversations.clear();
  core.conversationBackend.clear();
  core.conversationCwd.clear();
  core.threadSessionBindings.clear();
  vi.restoreAllMocks();
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
    expect(core.conversationCwd.get('thread-123')).toBe('/tmp/project');

    interaction.options.getSubcommand.mockReturnValue('show');
    await handler?.(interaction);
    expect(replies.at(-1)).toContain('/tmp/project');

    interaction.options.getSubcommand.mockReturnValue('clear');
    await handler?.(interaction);
    expect(core.conversationCwd.has('thread-123')).toBe(false);
  });

  it('routes /compact through the shared platform runner instead of a direct session path', async () => {
    const handler = claudeControlCommandHandlers.get('compact');
    expect(handler).toBeDefined();

    core.conversationBackend.set('thread-compact', 'claude');
    core.openThreadSessionBinding({
      conversationId: 'thread-compact',
      backend: 'claude',
      now: '2026-03-07T00:00:00.000Z',
    });

    const runPlatformConversationSpy = vi.spyOn(core, 'runPlatformConversation').mockImplementation(async (options) => {
      await options.render(
        {
          target: options.target,
          showEnvironment: false,
        },
        (async function* () {
          yield { type: 'done', result: 'compact summary' } as const;
        })(),
      );
      return true;
    });
    const streamAgentToDiscordSpy = vi.spyOn(streamModule, 'streamAgentToDiscord').mockResolvedValue(undefined);

    const interaction = {
      channel: { id: 'thread-compact', isThread: () => true },
      deferReply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      fetchReply: vi.fn(async () => ({ id: 'reply-1' })),
      reply: vi.fn(async () => undefined),
    } as any;

    await handler?.(interaction);

    expect(runPlatformConversationSpy).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'thread-compact',
      prompt: 'Summarize our conversation and current task state briefly.',
      backend: 'claude',
    }));
    expect(streamAgentToDiscordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: interaction.channel,
        initialMessage: { id: 'reply-1' },
        showEnvironment: false,
      }),
      expect.any(Object),
    );
  });
});
