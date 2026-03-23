import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PlatformAdapter, IncomingMessage } from '@agent-im-relay/core';
import type { ILinkClientEvent, ILinkMessage } from '../types';
import type { WeChatConfig } from '../config';
import { WeChatAdapter } from '../adapter';

const flushMicrotasks = () => vi.advanceTimersByTimeAsync(0);

const baseConfig: WeChatConfig = {
  name: 'TestBot',
  sessionToken: 'tok_test',
  reconnectMaxDelayMs: 30_000,
  heartbeatIntervalMs: 30_000,
  streamingCharThreshold: 500,
  streamingTimeThresholdMs: 3_000,
  selectionTimeoutMs: 10_000,
};

function makeILinkMessage(overrides: Partial<ILinkMessage> = {}): ILinkMessage {
  return {
    msgId: 'msg_001',
    type: 'text',
    content: 'hello',
    fromUser: 'user_001',
    fromUserName: 'Alice',
    toUser: 'bot',
    contextToken: 'ctx_abc',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('WeChatAdapter', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch = vi.fn().mockReturnValue(new Promise(() => {}));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('implements PlatformAdapter interface', () => {
    const adapter = new WeChatAdapter(baseConfig, mockFetch);
    const pa: PlatformAdapter = adapter;

    expect(pa.name).toBe('wechat');
    expect(pa.messageSender).toBeDefined();
    expect(pa.messageSender.maxMessageLength).toBe(2000);
  });

  it('start() connects iLink client and emits connected', async () => {
    mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, data: { messages: [], nextPollMs: 0 } }),
      })
      .mockReturnValue(new Promise(() => {}));

    const adapter = new WeChatAdapter(baseConfig, mockFetch);
    const events: string[] = [];
    adapter.onMessage(() => {});
    adapter.onStatusChange((status) => events.push(status));

    const startPromise = adapter.start();
    await flushMicrotasks();

    expect(events).toContain('connected');

    adapter.stop();
    await startPromise;
  });

  it('stop() disconnects cleanly', async () => {
    mockFetch = vi.fn().mockReturnValue(new Promise(() => {}));

    const adapter = new WeChatAdapter(baseConfig, mockFetch);
    const events: string[] = [];
    adapter.onStatusChange((status) => events.push(status));

    const startPromise = adapter.start();
    await flushMicrotasks();

    adapter.stop();
    await startPromise;

    expect(events).toContain('disconnected');
  });

  it('forwards inbound iLink messages as IncomingMessage via onMessage', async () => {
    const msg = makeILinkMessage({ msgId: 'msg_in_001', content: 'Hi bot' });
    const received: IncomingMessage[] = [];

    mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, data: { messages: [msg], nextPollMs: 0 } }),
      })
      .mockReturnValue(new Promise(() => {}));

    const adapter = new WeChatAdapter(baseConfig, mockFetch);
    adapter.onMessage((m) => received.push(m));

    const startPromise = adapter.start();
    await flushMicrotasks();

    expect(received).toHaveLength(1);
    expect(received[0].id).toBe('msg_in_001');
    expect(received[0].content).toBe('Hi bot');
    expect(received[0].conversationId).toBe('wechat:user_001');

    adapter.stop();
    await startPromise;
  });

  it('caches contextToken from inbound messages for outbound use', async () => {
    const msg = makeILinkMessage({ fromUser: 'user_x', contextToken: 'ctx_fresh' });

    let callIndex = 0;
    mockFetch = vi.fn().mockImplementation(async (url: string) => {
      callIndex++;
      if (callIndex === 1) {
        // poll returns message
        return {
          ok: true,
          json: async () => ({ code: 0, data: { messages: [msg], nextPollMs: 0 } }),
        };
      }
      if (url.includes('/messages/send')) {
        return {
          ok: true,
          json: async () => ({ code: 0, data: { msgId: 'sent_001' } }),
        };
      }
      // hang for poll
      return new Promise(() => {});
    });

    const adapter = new WeChatAdapter(baseConfig, mockFetch);
    adapter.onMessage(() => {});

    const startPromise = adapter.start();
    await flushMicrotasks();

    // Now send a message — should use the cached contextToken
    const msgId = await adapter.messageSender.send('wechat:user_x', 'Reply');
    expect(msgId).toBe('sent_001');

    const sendCall = mockFetch.mock.calls.find(([url]: [string]) => url.includes('/messages/send'));
    expect(sendCall).toBeDefined();
    const body = JSON.parse(sendCall![1].body);
    expect(body.contextToken).toBe('ctx_fresh');

    adapter.stop();
    await startPromise;
  });

  it('provides interactiveUI with showSelectMenu', () => {
    const adapter = new WeChatAdapter(baseConfig, mockFetch);
    expect(adapter.interactiveUI).toBeDefined();
    expect(typeof adapter.interactiveUI!.showSelectMenu).toBe('function');
  });

  it('provides markdownFormatter', () => {
    const adapter = new WeChatAdapter(baseConfig, mockFetch);
    expect(adapter.markdownFormatter).toBeDefined();

    const result = adapter.markdownFormatter!.format('**bold** and `code`');
    expect(result.text).toContain('bold');
  });
});
