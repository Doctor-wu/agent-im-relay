import { afterEach, describe, expect, it, vi } from 'vitest';

function createMockTransport() {
  return {
    createThread: vi.fn(async () => ({
      channelId: 'C123',
      threadTs: '1741766400.123456',
      rootMessageTs: '1741766400.123456',
    })),
    sendMessage: vi.fn(async () => ({ ts: '1741766401.000001' })),
    updateMessage: vi.fn(async () => undefined),
    showSelectMenu: vi.fn(async () => undefined),
  };
}

afterEach(async () => {
  const { resetSlackStateForTests } = await import('../state.js');
  resetSlackStateForTests();
});

describe('createSlackAdapter', () => {
  it('returns an adapter with Slack capabilities', async () => {
    const { createSlackAdapter } = await import('../adapter.js');
    const adapter = createSlackAdapter({
      transport: createMockTransport(),
    });

    expect(adapter.name).toBe('slack');
    expect(adapter.messageSender).toBeDefined();
    expect(adapter.conversationManager).toBeDefined();
    expect(adapter.statusIndicator).toBeDefined();
    expect(adapter.interactiveUI).toBeDefined();
    expect(adapter.markdownFormatter).toBeDefined();
  });
});

describe('Slack message sender', () => {
  it('sends and edits messages against a mapped Slack thread', async () => {
    const { createSlackAdapter } = await import('../adapter.js');
    const { rememberSlackConversation } = await import('../state.js');
    const transport = createMockTransport();
    const adapter = createSlackAdapter({ transport });

    rememberSlackConversation({
      conversationId: '1741766400.123456',
      channelId: 'C123',
      threadTs: '1741766400.123456',
      rootMessageTs: '1741766400.123456',
    });

    const messageId = await adapter.messageSender.send('1741766400.123456', 'hello', [{ type: 'section' }]);
    await adapter.messageSender.edit('1741766400.123456', messageId, 'updated');

    expect(transport.sendMessage).toHaveBeenCalledWith({
      channelId: 'C123',
      threadTs: '1741766400.123456',
      text: 'hello',
      blocks: [{ type: 'section' }],
    });
    expect(transport.updateMessage).toHaveBeenCalledWith({
      channelId: 'C123',
      ts: '1741766401.000001',
      text: 'updated',
      blocks: undefined,
    });
  });
});

describe('Slack conversation manager', () => {
  it('creates a new thread for a registered slash-command trigger', async () => {
    const { createSlackAdapter } = await import('../adapter.js');
    const {
      getSlackConversation,
      registerSlackTriggerContext,
    } = await import('../state.js');
    const transport = createMockTransport();
    const adapter = createSlackAdapter({ transport });

    registerSlackTriggerContext('trigger-1', {
      channelId: 'C123',
    });

    const conversationId = await adapter.conversationManager!.createConversation('trigger-1', {
      authorName: 'Alice',
      prompt: 'ship it',
    });

    expect(conversationId).toBe('1741766400.123456');
    expect(transport.createThread).toHaveBeenCalledWith({
      channelId: 'C123',
      authorName: 'Alice',
      prompt: 'ship it',
    });
    expect(getSlackConversation(conversationId)).toMatchObject({
      channelId: 'C123',
      threadTs: '1741766400.123456',
    });
  });
});

describe('Slack status and interactive UI', () => {
  it('reuses a visible status message for repeated status updates', async () => {
    const { createSlackAdapter } = await import('../adapter.js');
    const { rememberSlackConversation } = await import('../state.js');
    const transport = createMockTransport();
    const adapter = createSlackAdapter({ transport });

    rememberSlackConversation({
      conversationId: '1741766400.123456',
      channelId: 'C123',
      threadTs: '1741766400.123456',
      rootMessageTs: '1741766400.123456',
    });

    await adapter.statusIndicator!.setStatus('1741766400.123456', 'thinking');
    await adapter.statusIndicator!.setStatus('1741766400.123456', 'tool_running');

    expect(transport.sendMessage).toHaveBeenCalledTimes(1);
    expect(transport.updateMessage).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'C123',
      ts: '1741766401.000001',
      text: expect.stringContaining('tool_running'),
    }));
  });

  it('waits for a matching interactive selection and ignores unrelated ones', async () => {
    const { createSlackAdapter } = await import('../adapter.js');
    const {
      rememberSlackConversation,
      resolveSlackInteractiveValue,
    } = await import('../state.js');
    const transport = createMockTransport();
    const adapter = createSlackAdapter({ transport });

    rememberSlackConversation({
      conversationId: '1741766400.123456',
      channelId: 'C123',
      threadTs: '1741766400.123456',
      rootMessageTs: '1741766400.123456',
    });

    const promise = adapter.interactiveUI!.showSelectMenu('1741766400.123456', {
      placeholder: 'Pick backend',
      options: [
        { label: 'Claude', value: 'claude' },
        { label: 'Codex', value: 'codex' },
      ],
    });

    expect(transport.showSelectMenu).toHaveBeenCalledWith({
      conversationId: '1741766400.123456',
      channelId: 'C123',
      threadTs: '1741766400.123456',
      placeholder: 'Pick backend',
      options: [
        { label: 'Claude', value: 'claude' },
        { label: 'Codex', value: 'codex' },
      ],
    });

    expect(resolveSlackInteractiveValue('other-thread', 'codex')).toBe(false);
    expect(resolveSlackInteractiveValue('1741766400.123456', 'codex')).toBe(true);
    await expect(promise).resolves.toBe('codex');
  });
});
