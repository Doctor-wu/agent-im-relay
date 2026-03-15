import { describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, StatusIndicator, ConversationManager, MarkdownFormatter, IncomingMessage } from '../types';
import type { AgentStreamEvent } from '../agent/session';
import { Orchestrator } from '../orchestrator';

function createMockAdapter(overrides: Partial<PlatformAdapter> = {}): PlatformAdapter {
  return {
    name: 'test',
    messageSender: {
      send: vi.fn().mockResolvedValue('msg-1'),
      edit: vi.fn().mockResolvedValue(undefined),
      maxMessageLength: 2000,
    },
    ...overrides,
  };
}

function createIncomingMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: 'msg-trigger',
    conversationId: 'conv-1',
    content: 'Hello Claude',
    authorId: 'user-1',
    authorName: 'Test User',
    isBotMention: true,
    raw: {},
    ...overrides,
  };
}

async function* fakeAgentStream(events: AgentStreamEvent[]): AsyncGenerator<AgentStreamEvent> {
  for (const event of events) {
    yield event;
  }
}

describe('Orchestrator', () => {
  it('sends agent response via messageSender', async () => {
    const adapter = createMockAdapter();
    const orchestrator = new Orchestrator();

    await orchestrator.handleMessage(adapter, createIncomingMessage(), () =>
      fakeAgentStream([
        { type: 'text', delta: 'Hello!' },
        { type: 'done', result: 'Hello!' },
      ]),
    );

    expect(adapter.messageSender.send).toHaveBeenCalled();
  });

  it('calls statusIndicator when available', async () => {
    const statusIndicator: StatusIndicator = {
      setStatus: vi.fn().mockResolvedValue(undefined),
      clearStatus: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = createMockAdapter({ statusIndicator });
    const orchestrator = new Orchestrator();

    await orchestrator.handleMessage(adapter, createIncomingMessage(), () =>
      fakeAgentStream([
        { type: 'text', delta: 'Hi' },
        { type: 'done', result: 'Hi' },
      ]),
    );

    expect(statusIndicator.setStatus).toHaveBeenCalledWith('conv-1', 'thinking', expect.anything());
    expect(statusIndicator.clearStatus).toHaveBeenCalled();
  });

  it('works without optional capabilities', async () => {
    const adapter = createMockAdapter();
    const orchestrator = new Orchestrator();

    // No statusIndicator, no conversationManager, no markdownFormatter — should not throw
    await expect(
      orchestrator.handleMessage(adapter, createIncomingMessage(), () =>
        fakeAgentStream([
          { type: 'text', delta: 'Works' },
          { type: 'done', result: 'Works' },
        ]),
      ),
    ).resolves.not.toThrow();
  });

  it('creates conversation via conversationManager when no conversationId', async () => {
    const conversationManager: ConversationManager = {
      createConversation: vi.fn().mockResolvedValue('new-conv'),
      getConversationId: vi.fn().mockReturnValue(null),
    };
    const adapter = createMockAdapter({ conversationManager });
    const orchestrator = new Orchestrator();

    await orchestrator.handleMessage(
      adapter,
      createIncomingMessage({ conversationId: null }),
      () => fakeAgentStream([
        { type: 'text', delta: 'Created' },
        { type: 'done', result: 'Created' },
      ]),
    );

    expect(conversationManager.createConversation).toHaveBeenCalledWith('msg-trigger', {
      authorName: 'Test User',
      prompt: 'Hello Claude',
    });
  });

  it('applies markdownFormatter before sending', async () => {
    const markdownFormatter: MarkdownFormatter = {
      format: vi.fn().mockReturnValue({ text: 'formatted text', extras: { embeds: [] } }),
    };
    const adapter = createMockAdapter({ markdownFormatter });
    const orchestrator = new Orchestrator();

    await orchestrator.handleMessage(adapter, createIncomingMessage(), () =>
      fakeAgentStream([
        { type: 'text', delta: '**bold**' },
        { type: 'done', result: '**bold**' },
      ]),
    );

    expect(markdownFormatter.format).toHaveBeenCalled();
  });
});
