import { describe, expect, it, vi } from 'vitest';
import type { ClientToGatewayEvent } from '@agent-im-relay/core';
import { createGatewayBridge } from '../gateway-bridge.js';
import { createGatewayStateStore } from '../gateway-state.js';

function createBridge(options: {
  now?: () => number;
  timestamp?: () => string;
  staleAfterMs?: number;
} = {}) {
  const sink = {
    sendText: vi.fn(async () => undefined),
    sendCard: vi.fn(async () => undefined),
    sendFile: vi.fn(async () => undefined),
  };
  const state = createGatewayStateStore({
    now: options.now ?? (() => 1_000),
    staleAfterMs: options.staleAfterMs,
  });
  const bridge = createGatewayBridge({
    state,
    sink,
    now: options.timestamp ?? (() => '2026-03-07T00:00:00.000Z'),
  });

  return { bridge, sink, state };
}

describe('gateway bridge', () => {
  it('registers a client connection and keeps it active for routing', () => {
    const { bridge, state } = createBridge();

    bridge.registerClient({
      type: 'client.hello',
      clientId: 'client-a',
      requestId: 'hello-1',
      timestamp: '2026-03-07T00:00:00.000Z',
      payload: {
        token: 'secret',
      },
    });

    expect(state.getClient('client-a')).toEqual(expect.objectContaining({
      clientId: 'client-a',
    }));
    expect(state.getActiveClientId()).toBe('client-a');
  });

  it('routes a conversation command to the active client queue', () => {
    const { bridge, state } = createBridge();
    state.registerClient('client-a');

    const result = bridge.dispatchRunCommand({
      conversationId: 'conv-1',
      target: {
        chatId: 'chat-1',
        replyToMessageId: 'msg-1',
      },
      prompt: 'hello',
      mode: 'code',
    });

    expect(result).toEqual({
      kind: 'queued',
      clientId: 'client-a',
      requestId: expect.any(String),
    });
    expect(bridge.pullCommands('client-a')).toEqual([
      expect.objectContaining({
        type: 'conversation.run',
        conversationId: 'conv-1',
      }),
    ]);
  });

  it('returns an explicit offline result when no client is connected', () => {
    const { bridge } = createBridge();

    expect(bridge.dispatchRunCommand({
      conversationId: 'conv-offline',
      target: {
        chatId: 'chat-1',
      },
      prompt: 'hello',
      mode: 'code',
    })).toEqual({
      kind: 'offline',
      reason: 'client-offline',
    });
  });

  it('treats stale clients as offline instead of queueing forever', () => {
    let currentTime = 1_000;
    const { bridge, state } = createBridge({
      now: () => currentTime,
      staleAfterMs: 100,
    });

    state.registerClient('client-a');
    currentTime = 1_101;

    expect(bridge.dispatchRunCommand({
      conversationId: 'conv-stale',
      target: {
        chatId: 'chat-1',
      },
      prompt: 'hello',
      mode: 'code',
    })).toEqual({
      kind: 'offline',
      reason: 'client-offline',
    });
  });

  it('routes client responses back to the pending request target', async () => {
    const { bridge, sink, state } = createBridge();
    state.registerClient('client-a');

    const result = bridge.dispatchRunCommand({
      conversationId: 'conv-1',
      target: {
        chatId: 'chat-1',
        replyToMessageId: 'msg-1',
      },
      prompt: 'hello',
      mode: 'code',
    });
    if (result.kind !== 'queued') {
      throw new Error('expected queued request');
    }

    const event: ClientToGatewayEvent = {
      type: 'conversation.text',
      clientId: 'client-a',
      requestId: result.requestId,
      conversationId: 'conv-1',
      timestamp: '2026-03-07T00:00:01.000Z',
      payload: {
        text: 'reply text',
      },
    };

    await bridge.consumeClientEvent(event);
    await bridge.consumeClientEvent({
      type: 'conversation.done',
      clientId: 'client-a',
      requestId: result.requestId,
      conversationId: 'conv-1',
      timestamp: '2026-03-07T00:00:02.000Z',
      payload: {
        status: 'completed',
      },
    });

    expect(sink.sendText).toHaveBeenCalledWith({
      chatId: 'chat-1',
      replyToMessageId: 'msg-1',
    }, 'reply text');
    expect(state.getPendingRequest(result.requestId)).toBeUndefined();
  });

  it('stores blocked setup state on the gateway and can redispatch the original run', async () => {
    const { bridge, state } = createBridge();
    state.registerClient('client-a');

    const result = bridge.dispatchRunCommand({
      conversationId: 'conv-setup',
      target: {
        chatId: 'chat-1',
        replyToMessageId: 'msg-1',
      },
      prompt: 'finish setup',
      mode: 'code',
    });
    if (result.kind !== 'queued') {
      throw new Error('expected queued request');
    }

    expect(bridge.pullCommands('client-a')).toHaveLength(1);

    await bridge.consumeClientEvent({
      type: 'conversation.done',
      clientId: 'client-a',
      requestId: result.requestId,
      conversationId: 'conv-setup',
      timestamp: '2026-03-07T00:00:02.000Z',
      payload: {
        status: 'blocked',
      },
    });

    expect(state.getPendingSetup('conv-setup')).toEqual(expect.objectContaining({
      conversationId: 'conv-setup',
      prompt: 'finish setup',
      mode: 'code',
    }));

    const resumed = bridge.dispatchPendingRun('conv-setup');
    expect(resumed).toEqual({
      kind: 'queued',
      clientId: 'client-a',
      requestId: expect.any(String),
    });
    expect(state.getPendingSetup('conv-setup')).toBeUndefined();
    expect(bridge.pullCommands('client-a')).toEqual([
      expect.objectContaining({
        type: 'conversation.run',
        conversationId: 'conv-setup',
        payload: expect.objectContaining({
          prompt: 'finish setup',
          mode: 'code',
        }),
      }),
    ]);
  });
});
