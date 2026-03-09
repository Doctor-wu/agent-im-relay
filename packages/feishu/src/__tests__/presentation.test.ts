import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFeishuLaunchStateForTests } from '../index.js';
import {
  presentFeishuBusyNotice,
  presentFeishuFinalOutput,
  presentFeishuInterruptCard,
} from '../presentation.js';

describe('Feishu presentation', () => {
  beforeEach(() => {
    resetFeishuLaunchStateForTests();
  });

  it('emits the interrupt card at most once per dispatch', async () => {
    const transport = {
      sendCard: vi.fn(async () => 'card-1'),
      sendText: vi.fn(async () => undefined),
    };
    const target = {
      chatId: 'session-chat-1',
      replyToMessageId: 'message-1',
    };

    await expect(presentFeishuInterruptCard({
      dispatchId: 'message-1',
      conversationId: 'session-chat-1',
      target,
      transport,
    })).resolves.toEqual({ kind: 'emitted' });

    await expect(presentFeishuInterruptCard({
      dispatchId: 'message-1',
      conversationId: 'session-chat-1',
      target,
      transport,
    })).resolves.toEqual({ kind: 'skipped' });

    expect(transport.sendCard).toHaveBeenCalledOnce();
  });

  it('emits busy and final output at most once per dispatch', async () => {
    const transport = {
      sendCard: vi.fn(async () => 'card-1'),
      sendText: vi.fn(async () => undefined),
    };
    const target = {
      chatId: 'session-chat-1',
      replyToMessageId: 'message-2',
    };

    await expect(presentFeishuBusyNotice({
      dispatchId: 'message-2',
      target,
      transport,
    })).resolves.toEqual({ kind: 'emitted' });
    await expect(presentFeishuBusyNotice({
      dispatchId: 'message-2',
      target,
      transport,
    })).resolves.toEqual({ kind: 'skipped' });

    await expect(presentFeishuFinalOutput({
      dispatchId: 'message-2',
      output: 'final answer',
      target,
      transport,
    })).resolves.toEqual({ kind: 'emitted' });
    await expect(presentFeishuFinalOutput({
      dispatchId: 'message-2',
      output: 'final answer',
      target,
      transport,
    })).resolves.toEqual({ kind: 'skipped' });

    expect(transport.sendText).toHaveBeenCalledTimes(2);
    expect(transport.sendText).toHaveBeenNthCalledWith(1, target, 'Conversation is already running.');
    expect(transport.sendText).toHaveBeenNthCalledWith(2, target, 'final answer');
  });
});
