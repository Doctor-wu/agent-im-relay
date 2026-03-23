import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ILinkSendResult } from '../types';

import { WeChatMessageSender } from '../message-sender';
import { ContextTokenCache } from '../message-handler';
import type { ILinkFetch } from '../types';

function makeSendResponse(msgId = 'sent_001') {
  return { msgId };
}

function createMockFetch(responses: Array<{ ok: boolean; body: unknown }> = []) {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return {
      ok: resp?.ok ?? true,
      status: resp?.ok === false ? 500 : 200,
      json: async () => resp?.body ?? { code: 0, data: makeSendResponse() },
    } as Response;
  });
}

describe('WeChatMessageSender', () => {
  let cache: ContextTokenCache;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let sender: WeChatMessageSender;

  beforeEach(() => {
    cache = new ContextTokenCache();
    mockFetch = createMockFetch([
      { ok: true, body: { code: 0, data: makeSendResponse('sent_001') } },
    ]);
    sender = new WeChatMessageSender(mockFetch, cache, 'tok_session');
  });

  it('sends a text message with correct contextToken', async () => {
    cache.set('user_001', 'ctx_abc');

    const msgId = await sender.send('wechat:user_001', 'Hello!');

    expect(msgId).toBe('sent_001');
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/messages/send');
    const body = JSON.parse(init?.body as string);
    expect(body.toUser).toBe('user_001');
    expect(body.contextToken).toBe('ctx_abc');
    expect(body.content).toBe('Hello!');
    expect(body.type).toBe('text');
    // Verify Bearer auth header
    expect(init?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer tok_session' }));
  });

  it('returns empty messageId when contextToken is missing (no crash)', async () => {
    // No contextToken cached for this user
    const msgId = await sender.send('wechat:user_unknown', 'Hi there');

    // Should not call fetch since we don't have a contextToken
    expect(mockFetch).not.toHaveBeenCalled();
    expect(msgId).toBe('');
  });

  it('edits a message by sending a new message (WeChat has no edit API)', async () => {
    cache.set('user_001', 'ctx_abc');

    await sender.edit('wechat:user_001', 'old_msg_id', 'Updated content');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.content).toBe('Updated content');
  });

  it('auto-segments text exceeding WeChat message limit', async () => {
    cache.set('user_001', 'ctx_abc');

    // Generate text longer than maxMessageLength (2000)
    const longText = 'A'.repeat(2500);

    mockFetch = createMockFetch([
      { ok: true, body: { code: 0, data: makeSendResponse('sent_part1') } },
      { ok: true, body: { code: 0, data: makeSendResponse('sent_part2') } },
    ]);
    sender = new WeChatMessageSender(mockFetch, cache, 'tok_session');

    const msgId = await sender.send('wechat:user_001', longText);

    // Should send 2 messages
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Returns the last message ID
    expect(msgId).toBe('sent_part2');
  });

  it('retries on send failure up to 2 times', async () => {
    cache.set('user_001', 'ctx_abc');

    mockFetch = createMockFetch([
      { ok: false, body: { code: -1, message: 'server error' } },
      { ok: false, body: { code: -1, message: 'server error' } },
      { ok: true, body: { code: 0, data: makeSendResponse('sent_retry') } },
    ]);
    sender = new WeChatMessageSender(mockFetch, cache, 'tok_session');

    const msgId = await sender.send('wechat:user_001', 'retry test');

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(msgId).toBe('sent_retry');
  });

  it('returns empty messageId after all retries exhausted', async () => {
    cache.set('user_001', 'ctx_abc');

    mockFetch = createMockFetch([
      { ok: false, body: { code: -1 } },
      { ok: false, body: { code: -1 } },
      { ok: false, body: { code: -1 } },
    ]);
    sender = new WeChatMessageSender(mockFetch, cache, 'tok_session');

    const msgId = await sender.send('wechat:user_001', 'will fail');

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(msgId).toBe('');
  });

  it('exposes maxMessageLength of 2000', () => {
    expect(sender.maxMessageLength).toBe(2000);
  });

  it('extracts user ID from wechat: conversationId prefix', async () => {
    cache.set('wx_abc_123', 'ctx_tok');

    await sender.send('wechat:wx_abc_123', 'test');

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.toUser).toBe('wx_abc_123');
  });
});
