import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage } from '@agent-im-relay/core';
import type { ILinkMessage } from '../types';
import type { WeChatConfig } from '../config';
import { WeChatAdapter } from '../adapter';

const flushMicrotasks = () => vi.advanceTimersByTimeAsync(0);

const config: WeChatConfig = {
  name: 'IntegrationBot',
  sessionToken: 'tok_integration',
  reconnectMaxDelayMs: 30_000,
  heartbeatIntervalMs: 30_000,
  streamingCharThreshold: 500,
  streamingTimeThresholdMs: 3_000,
  selectionTimeoutMs: 10_000,
};

function makeMsg(overrides: Partial<ILinkMessage> = {}): ILinkMessage {
  return {
    msgId: `msg_${Math.random().toString(36).slice(2, 8)}`,
    type: 'text',
    content: 'test message',
    fromUser: 'user_int',
    fromUserName: 'Tester',
    toUser: 'bot',
    contextToken: 'ctx_int',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('Integration: full message round-trip', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('QR login → receive text → process → reply', async () => {
    const qrConfig: WeChatConfig = { ...config, sessionToken: undefined };
    const received: IncomingMessage[] = [];
    const msg = makeMsg({ content: 'Hello bot!' });

    let callIndex = 0;
    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      callIndex++;
      // 1) QR code request
      if (callIndex === 1) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            data: { qrCodeUrl: 'https://ilink/qr/test', expireSeconds: 120 },
          }),
        };
      }
      // 2) Scan status → confirmed
      if (callIndex === 2) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            data: { status: 'confirmed', sessionToken: 'tok_qr_scan' },
          }),
        };
      }
      // 3) First poll → deliver message
      if (callIndex === 3) {
        return {
          ok: true,
          json: async () => ({ code: 0, data: { messages: [msg], nextPollMs: 0 } }),
        };
      }
      // 4) Send reply
      if (url.includes('/messages/send')) {
        return {
          ok: true,
          json: async () => ({ code: 0, data: { msgId: 'sent_reply' } }),
        };
      }
      // Subsequent polls hang
      return new Promise(() => {});
    });

    const adapter = new WeChatAdapter(qrConfig, mockFetch);
    adapter.onMessage((m) => received.push(m));

    const startPromise = adapter.start();
    await flushMicrotasks();

    // Message received
    expect(received).toHaveLength(1);
    expect(received[0].content).toBe('Hello bot!');

    // Reply using cached contextToken
    const replyId = await adapter.messageSender.send('wechat:user_int', 'Got your message!');
    expect(replyId).toBe('sent_reply');

    adapter.stop();
    await startPromise;
  });

  it('receive image message → process → reply with text', async () => {
    const imgMsg = makeMsg({
      type: 'image',
      content: '',
      media: { mediaId: 'media_img', url: 'https://ilink/img.jpg', mimeType: 'image/jpeg', size: 5000 },
    });
    const received: IncomingMessage[] = [];

    let callIndex = 0;
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      callIndex++;
      if (callIndex === 1) {
        return {
          ok: true,
          json: async () => ({ code: 0, data: { messages: [imgMsg], nextPollMs: 0 } }),
        };
      }
      if (url.includes('/messages/send')) {
        return { ok: true, json: async () => ({ code: 0, data: { msgId: 'sent_img_reply' } }) };
      }
      return new Promise(() => {});
    });

    const adapter = new WeChatAdapter(config, mockFetch);
    adapter.onMessage((m) => received.push(m));

    const startPromise = adapter.start();
    await flushMicrotasks();

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe('[图片]');

    const replyId = await adapter.messageSender.send('wechat:user_int', '已收到图片');
    expect(replyId).toBe('sent_img_reply');

    adapter.stop();
    await startPromise;
  });

  it('connection drop → reconnect → resume receiving', async () => {
    const received: IncomingMessage[] = [];
    const statuses: string[] = [];

    let callIndex = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) {
        // First poll succeeds with message
        return {
          ok: true,
          json: async () => ({
            code: 0,
            data: { messages: [makeMsg({ msgId: 'msg_1', content: 'first' })], nextPollMs: 0 },
          }),
        };
      }
      if (callIndex === 2) {
        // Second poll fails (connection drop)
        throw new Error('network error');
      }
      if (callIndex === 3) {
        // After backoff, third poll succeeds
        return {
          ok: true,
          json: async () => ({
            code: 0,
            data: { messages: [makeMsg({ msgId: 'msg_2', content: 'after reconnect' })], nextPollMs: 0 },
          }),
        };
      }
      return new Promise(() => {});
    });

    const adapter = new WeChatAdapter(config, mockFetch);
    adapter.onMessage((m) => received.push(m));
    adapter.onStatusChange((s) => statuses.push(s));

    const startPromise = adapter.start();
    await flushMicrotasks();

    // First message received
    expect(received).toHaveLength(1);
    expect(received[0].content).toBe('first');

    // Second poll fails → backoff 1s
    await flushMicrotasks();

    // Advance past backoff
    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();

    // Message after reconnect
    expect(received).toHaveLength(2);
    expect(received[1].content).toBe('after reconnect');

    adapter.stop();
    await startPromise;
  });

  it('markdown formatting produces plain text for WeChat', () => {
    const mockFetch = vi.fn().mockReturnValue(new Promise(() => {}));
    const adapter = new WeChatAdapter(config, mockFetch);

    const result = adapter.markdownFormatter!.format(
      '# Title\n**bold** and *italic*\n[link](https://example.com)\n```js\nconsole.log("hi")\n```',
    );

    expect(result.text).not.toContain('#');
    expect(result.text).not.toContain('**');
    expect(result.text).not.toContain('*');
    expect(result.text).toContain('bold');
    expect(result.text).toContain('italic');
    expect(result.text).toContain('link');
    expect(result.text).toContain('console.log');
    expect(result.text).not.toContain('```');
  });
});
