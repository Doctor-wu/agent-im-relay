import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processedEventIds } from '@agent-im-relay/core';
import {
  createFeishuSignature,
  handleFeishuCallback,
} from '../index.js';

describe('Feishu security', () => {
  beforeEach(() => {
    processedEventIds.clear();
  });

  it('rejects invalid callback signatures', async () => {
    const body = JSON.stringify({
      header: {
        event_id: 'event-1',
        event_type: 'im.message.receive_v1',
      },
      event: {},
    });

    await expect(handleFeishuCallback({
      body,
      headers: {
        'x-lark-request-timestamp': '1700000000',
        'x-lark-request-nonce': 'nonce-1',
        'x-lark-signature': 'bad-signature',
      },
      signingSecret: 'test-secret',
      runEvent: vi.fn(),
    })).rejects.toThrow(/invalid feishu signature/i);
  });

  it('rejects callback requests when Feishu signing headers are missing', async () => {
    const body = JSON.stringify({
      header: {
        event_id: 'event-missing-headers',
        event_type: 'im.message.receive_v1',
      },
      event: {},
    });

    await expect(handleFeishuCallback({
      body,
      headers: {},
      signingSecret: 'test-secret',
      runEvent: vi.fn(),
    })).rejects.toThrow(/invalid feishu signature/i);
  });

  it('rejects malformed event payloads before business logic runs', async () => {
    const body = JSON.stringify({ event: {} });
    const signature = createFeishuSignature({
      body,
      nonce: 'nonce-malformed',
      signingSecret: 'test-secret',
      timestamp: '1700000000',
    });

    await expect(handleFeishuCallback({
      body,
      headers: {
        'x-lark-request-timestamp': '1700000000',
        'x-lark-request-nonce': 'nonce-malformed',
        'x-lark-signature': signature,
      },
      signingSecret: 'test-secret',
      runEvent: vi.fn(),
    })).rejects.toThrow(/malformed feishu event payload/i);
  });

  it('does not start duplicate runs for retried event deliveries', async () => {
    const eventBody = JSON.stringify({
      header: {
        event_id: 'event-dup',
        event_type: 'im.message.receive_v1',
      },
      event: {
        message: {
          chat_id: 'chat-1',
          chat_type: 'p2p',
          message_id: 'message-1',
        },
      },
    });
    const signature = createFeishuSignature({
      body: eventBody,
      nonce: 'nonce-dup',
      signingSecret: 'test-secret',
      timestamp: '1700000000',
    });
    const runEvent = vi.fn(async () => {});

    const first = await handleFeishuCallback({
      body: eventBody,
      headers: {
        'x-lark-request-timestamp': '1700000000',
        'x-lark-request-nonce': 'nonce-dup',
        'x-lark-signature': signature,
      },
      signingSecret: 'test-secret',
      runEvent,
    });
    const second = await handleFeishuCallback({
      body: eventBody,
      headers: {
        'x-lark-request-timestamp': '1700000000',
        'x-lark-request-nonce': 'nonce-dup',
        'x-lark-signature': signature,
      },
      signingSecret: 'test-secret',
      runEvent,
    });

    expect(first).toEqual({ kind: 'accepted', eventId: 'event-dup' });
    expect(second).toEqual({ kind: 'duplicate', eventId: 'event-dup' });
    expect(runEvent).toHaveBeenCalledTimes(1);
  });

  it('does not mark an event as processed when the handler fails', async () => {
    const eventBody = JSON.stringify({
      header: {
        event_id: 'event-retry-after-failure',
        event_type: 'im.message.receive_v1',
      },
      event: {
        message: {
          chat_id: 'chat-1',
          chat_type: 'p2p',
          message_id: 'message-1',
        },
      },
    });
    const signature = createFeishuSignature({
      body: eventBody,
      nonce: 'nonce-failure',
      signingSecret: 'test-secret',
      timestamp: '1700000000',
    });
    const runEvent = vi.fn()
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValueOnce(undefined);

    await expect(handleFeishuCallback({
      body: eventBody,
      headers: {
        'x-lark-request-timestamp': '1700000000',
        'x-lark-request-nonce': 'nonce-failure',
        'x-lark-signature': signature,
      },
      signingSecret: 'test-secret',
      runEvent,
    })).rejects.toThrow(/transient failure/i);

    await expect(handleFeishuCallback({
      body: eventBody,
      headers: {
        'x-lark-request-timestamp': '1700000000',
        'x-lark-request-nonce': 'nonce-failure',
        'x-lark-signature': signature,
      },
      signingSecret: 'test-secret',
      runEvent,
    })).resolves.toEqual({ kind: 'accepted', eventId: 'event-retry-after-failure' });

    expect(runEvent).toHaveBeenCalledTimes(2);
  });
});
