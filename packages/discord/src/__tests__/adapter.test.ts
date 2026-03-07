import { afterEach, describe, expect, it, vi } from 'vitest';
import * as core from '@agent-im-relay/core';
import { createDiscordAdapter } from '../adapter.js';
import { claudeControlCommandHandlers } from '../commands/claude-control.js';
import { handleDoneCommand } from '../commands/done.js';
import { handleInterruptCommand } from '../commands/interrupt.js';

function makeMockClient() {
  const sentMessages = new Map<string, { content: string; edit: ReturnType<typeof vi.fn> }>();
  let msgCounter = 0;

  const mockChannel = {
    isTextBased: () => true,
    send: vi.fn(async (payload: any) => {
      msgCounter++;
      const id = `msg-${msgCounter}`;
      const content = typeof payload === 'string' ? payload : payload.content;
      const msg = { id, content, edit: vi.fn() };
      sentMessages.set(id, msg);
      return msg;
    }),
    messages: {
      fetch: vi.fn(async (id: string) => sentMessages.get(id) ?? null),
    },
  };

  const client = {
    user: { id: 'bot-user-id' },
    channels: {
      fetch: vi.fn(async () => mockChannel),
    },
  } as any;

  return { client, mockChannel, sentMessages };
}

function createThreadInteraction(overrides: Partial<any> = {}) {
  return {
    channel: {
      id: 'thread-123',
      isThread: () => true,
    },
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

afterEach(() => {
  core.conversationSessions.clear();
  core.activeConversations.clear();
  core.conversationModels.clear();
  core.conversationEffort.clear();
  vi.restoreAllMocks();
});

describe('createDiscordAdapter', () => {
  it('returns an adapter with all capabilities', () => {
    const { client } = makeMockClient();
    const adapter = createDiscordAdapter(client);

    expect(adapter.name).toBe('discord');
    expect(adapter.messageSender).toBeDefined();
    expect(adapter.conversationManager).toBeDefined();
    expect(adapter.statusIndicator).toBeDefined();
    expect(adapter.markdownFormatter).toBeDefined();
  });
});

describe('messageSender', () => {
  it('sends a message and returns its ID', async () => {
    const { client, mockChannel } = makeMockClient();
    const adapter = createDiscordAdapter(client);

    const msgId = await adapter.messageSender.send('channel-1', 'Hello');
    expect(msgId).toBe('msg-1');
    expect(mockChannel.send).toHaveBeenCalledWith('Hello');
  });

  it('sends with embeds when extras provided', async () => {
    const { client, mockChannel } = makeMockClient();
    const adapter = createDiscordAdapter(client);

    const embeds = [{ fields: [{ name: 'A', value: 'B', inline: true }] }];
    await adapter.messageSender.send('channel-1', 'Hi', embeds);
    expect(mockChannel.send).toHaveBeenCalledWith({ content: 'Hi', embeds });
  });

  it('edits a previously sent message', async () => {
    const { client, sentMessages } = makeMockClient();
    const adapter = createDiscordAdapter(client);

    const msgId = await adapter.messageSender.send('channel-1', 'Original');
    await adapter.messageSender.edit('channel-1', msgId, 'Updated');

    const msg = sentMessages.get(msgId);
    expect(msg?.edit).toHaveBeenCalledWith({ content: 'Updated' });
  });

  it('exposes maxMessageLength from config', () => {
    const { client } = makeMockClient();
    const adapter = createDiscordAdapter(client);

    expect(adapter.messageSender.maxMessageLength).toBeGreaterThanOrEqual(200);
  });
});

describe('markdownFormatter', () => {
  it('converts markdown tables to embeds', () => {
    const { client } = makeMockClient();
    const adapter = createDiscordAdapter(client);

    const result = adapter.markdownFormatter!.format(
      '| A | B |\n| --- | --- |\n| 1 | 2 |',
    );

    expect(result.text).toBe('');
    expect(result.extras).toBeDefined();
    expect((result.extras as any[]).length).toBe(1);
  });

  it('returns plain text with no extras for simple markdown', () => {
    const { client } = makeMockClient();
    const adapter = createDiscordAdapter(client);

    const result = adapter.markdownFormatter!.format('Hello world');
    expect(result.text).toBe('Hello world');
    expect(result.extras).toBeUndefined();
  });
});

describe('handleInterruptCommand', () => {
  it('routes interrupt through the shared session-control controller', async () => {
    const interaction = createThreadInteraction();
    vi.spyOn(core, 'applySessionControlCommand').mockReturnValue({
      kind: 'interrupt',
      conversationId: 'thread-123',
      interrupted: true,
      stateChanged: false,
      persist: false,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'interrupt.ok',
    });

    await handleInterruptCommand(interaction as any);

    expect(core.applySessionControlCommand).toHaveBeenCalledWith({
      conversationId: 'thread-123',
      type: 'interrupt',
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: '⏹️ 已请求中断当前任务。',
      ephemeral: true,
    });
  });

  it('replies when there is no active run', async () => {
    const interaction = createThreadInteraction();
    vi.spyOn(core, 'applySessionControlCommand').mockReturnValue({
      kind: 'interrupt',
      conversationId: 'thread-123',
      interrupted: false,
      stateChanged: false,
      persist: false,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'interrupt.noop',
    });

    await handleInterruptCommand(interaction as any);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: '当前没有正在执行的任务。',
      ephemeral: true,
    });
  });

  it('only works inside a thread', async () => {
    const interaction = createThreadInteraction({
      channel: {
        isThread: () => false,
      },
    });

    await handleInterruptCommand(interaction as any);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: '此命令只能在会话线程中使用。',
      ephemeral: true,
    });
  });
});

describe('handleDoneCommand', () => {
  it('keeps done replies unchanged while leaving runtime activity alone', async () => {
    const interaction = createThreadInteraction();
    core.conversationSessions.set('thread-123', 'session-1');
    core.activeConversations.add('thread-123');
    const applySessionControlCommandSpy = vi.spyOn(core, 'applySessionControlCommand');
    vi.spyOn(core, 'persistState').mockResolvedValue(undefined);
    vi.spyOn(core, 'interruptConversationRun');

    await handleDoneCommand(interaction as any);

    expect(applySessionControlCommandSpy).toHaveBeenCalledWith({
      conversationId: 'thread-123',
      type: 'done',
    });
    expect(core.conversationSessions.has('thread-123')).toBe(false);
    expect(core.activeConversations.has('thread-123')).toBe(true);
    expect(core.interruptConversationRun).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      '✅ Session ended. Start a new conversation by mentioning me again in a channel.',
    );
  });

  it('keeps idle done reply unchanged', async () => {
    const interaction = createThreadInteraction();
    vi.spyOn(core, 'applySessionControlCommand').mockReturnValue({
      kind: 'done',
      conversationId: 'thread-123',
      stateChanged: false,
      persist: false,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'done.noop',
    });

    await handleDoneCommand(interaction as any);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'No active session in this thread.',
      ephemeral: true,
    });
  });

  it('skips persistence when the controller reports a model noop', async () => {
    const handler = claudeControlCommandHandlers.get('model');
    expect(handler).toBeDefined();

    core.conversationModels.set('thread-123', 'claude-3-7');
    const interaction = createThreadInteraction({
      options: {
        getString: vi.fn().mockReturnValue('claude-3-7'),
      },
    });
    vi.spyOn(core, 'applySessionControlCommand').mockReturnValue({
      kind: 'model',
      conversationId: 'thread-123',
      value: 'claude-3-7',
      stateChanged: false,
      persist: false,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'model.noop',
    });
    const persistSpy = vi.spyOn(core, 'persistState').mockResolvedValue(undefined);

    await handler?.(interaction as any);

    expect(core.applySessionControlCommand).toHaveBeenCalledWith({
      conversationId: 'thread-123',
      type: 'model',
      value: 'claude-3-7',
    });
    expect(persistSpy).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Set model to `claude-3-7` for this thread.',
      ephemeral: true,
    });
  });
});
