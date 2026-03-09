import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFeishuLaunchStateForTests } from '../index.js';

const runtimeMocks = vi.hoisted(() => ({
  runFeishuConversation: vi.fn(),
}));

vi.mock('../runtime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime.js')>();
  return {
    ...actual,
    runFeishuConversation: runtimeMocks.runFeishuConversation,
  };
});

import { runFeishuSessionFlow } from '../session-flow.js';

describe('Feishu session flow', () => {
  beforeEach(() => {
    resetFeishuLaunchStateForTests();
    runtimeMocks.runFeishuConversation.mockReset();
  });

  it('shows one interrupt card and one final output for a normal session message', async () => {
    runtimeMocks.runFeishuConversation.mockImplementationOnce(async (options) => {
      await options.lifecycle?.onFinalOutput?.('final answer');
      return { kind: 'started' };
    });

    const transport = {
      sendCard: vi.fn(async () => 'card-1'),
      sendText: vi.fn(async () => undefined),
      updateCard: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => undefined),
    };

    await expect(runFeishuSessionFlow({
      conversationId: 'session-chat-1',
      target: {
        chatId: 'session-chat-1',
        replyToMessageId: 'message-1',
      },
      sourceMessageId: 'message-1',
      prompt: 'follow up',
      mode: 'code',
      transport,
      defaultCwd: process.cwd(),
    })).resolves.toEqual({ kind: 'started' });

    expect(transport.sendCard).toHaveBeenCalledOnce();
    expect(transport.sendText).toHaveBeenCalledOnce();
    expect(transport.sendText).toHaveBeenCalledWith({
      chatId: 'session-chat-1',
      replyToMessageId: 'message-1',
    }, 'final answer');
  });

  it('emits the busy notice only once for the same source message', async () => {
    runtimeMocks.runFeishuConversation.mockResolvedValue({ kind: 'busy' });

    const transport = {
      sendCard: vi.fn(async () => 'card-1'),
      sendText: vi.fn(async () => undefined),
      updateCard: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => undefined),
    };
    const options = {
      conversationId: 'session-chat-1',
      target: {
        chatId: 'session-chat-1',
        replyToMessageId: 'message-busy-1',
      },
      sourceMessageId: 'message-busy-1',
      prompt: 'follow up',
      mode: 'code' as const,
      transport,
      defaultCwd: process.cwd(),
    };

    await expect(runFeishuSessionFlow(options)).resolves.toEqual({ kind: 'busy' });
    await expect(runFeishuSessionFlow(options)).resolves.toEqual({ kind: 'busy' });

    expect(transport.sendCard).toHaveBeenCalledOnce();
    expect(transport.sendText).toHaveBeenCalledOnce();
    expect(transport.sendText).toHaveBeenCalledWith(options.target, 'Conversation is already running.');
  });

  it('routes runtime errors through presentation idempotency', async () => {
    runtimeMocks.runFeishuConversation.mockImplementation(async (options) => {
      await options.lifecycle?.onError?.('❌ failed');
      return { kind: 'started' };
    });

    const transport = {
      sendCard: vi.fn(async () => 'card-1'),
      sendText: vi.fn(async () => undefined),
      updateCard: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => undefined),
    };
    const options = {
      conversationId: 'session-chat-1',
      target: {
        chatId: 'session-chat-1',
        replyToMessageId: 'message-error-1',
      },
      sourceMessageId: 'message-error-1',
      prompt: 'follow up',
      mode: 'code' as const,
      transport,
      defaultCwd: process.cwd(),
    };

    await expect(runFeishuSessionFlow(options)).resolves.toEqual({ kind: 'started' });
    await expect(runFeishuSessionFlow(options)).resolves.toEqual({ kind: 'started' });

    expect(transport.sendText).toHaveBeenCalledOnce();
    expect(transport.sendText).toHaveBeenCalledWith(options.target, '❌ failed');
  });
});
