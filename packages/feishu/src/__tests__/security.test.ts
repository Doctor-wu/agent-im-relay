import { createCipheriv, createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processedEventIds } from '@agent-im-relay/core';
import {
  createFeishuSignature,
  handleFeishuCallback,
  unwrapFeishuCallbackBody,
} from '../index.js';

function encryptFeishuBody(body: string, encryptKey: string, iv = Buffer.from('0123456789abcdef')): string {
  const key = createHash('sha256').update(encryptKey).digest();
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  cipher.setAutoPadding(true);
  const ciphertext = Buffer.concat([
    cipher.update(body, 'utf8'),
    cipher.final(),
  ]);

  return JSON.stringify({
    encrypt: Buffer.concat([iv, ciphertext]).toString('base64'),
  });
}

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

  it('decrypts encrypted callback envelopes before payload parsing', () => {
    const body = JSON.stringify({
      header: {
        event_id: 'event-encrypted',
        event_type: 'im.message.receive_v1',
      },
      event: {
        message: {
          message_id: 'message-1',
        },
      },
    });

    expect(unwrapFeishuCallbackBody({
      body: encryptFeishuBody(body, 'encrypt-key'),
      encryptKey: 'encrypt-key',
    })).toBe(body);
  });

  it('rejects encrypted callback envelopes when FEISHU_ENCRYPT_KEY is missing', () => {
    const body = JSON.stringify({
      header: {
        event_id: 'event-encrypted-missing-key',
        event_type: 'im.message.receive_v1',
      },
      event: {},
    });

    expect(() => unwrapFeishuCallbackBody({
      body: encryptFeishuBody(body, 'encrypt-key'),
    })).toThrow(/FEISHU_ENCRYPT_KEY/i);
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

  it('keeps deferred events retryable when background processing fails', async () => {
    const eventBody = JSON.stringify({
      header: {
        event_id: 'event-deferred-retry',
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
      nonce: 'nonce-deferred',
      signingSecret: 'test-secret',
      timestamp: '1700000000',
    });
    const deferredFailure = Promise.reject(new Error('background failure'));
    const runEvent = vi.fn()
      .mockResolvedValueOnce({ deferred: deferredFailure })
      .mockResolvedValueOnce(undefined);

    await expect(handleFeishuCallback({
      body: eventBody,
      headers: {
        'x-lark-request-timestamp': '1700000000',
        'x-lark-request-nonce': 'nonce-deferred',
        'x-lark-signature': signature,
      },
      signingSecret: 'test-secret',
      runEvent,
    })).resolves.toEqual({ kind: 'accepted', eventId: 'event-deferred-retry' });

    await Promise.resolve();
    await Promise.resolve();

    await expect(handleFeishuCallback({
      body: eventBody,
      headers: {
        'x-lark-request-timestamp': '1700000000',
        'x-lark-request-nonce': 'nonce-deferred',
        'x-lark-signature': signature,
      },
      signingSecret: 'test-secret',
      runEvent,
    })).resolves.toEqual({ kind: 'accepted', eventId: 'event-deferred-retry' });

    expect(runEvent).toHaveBeenCalledTimes(2);
  });

  it('validates signatures against the raw request body while parsing the decrypted payload', async () => {
    const payloadBody = JSON.stringify({
      header: {
        event_id: 'event-encrypted-run',
        event_type: 'im.message.receive_v1',
      },
      event: {
        message: {
          chat_id: 'chat-1',
          message_id: 'message-1',
        },
      },
    });
    const encryptedBody = encryptFeishuBody(payloadBody, 'encrypt-key');
    const signature = createFeishuSignature({
      body: encryptedBody,
      nonce: 'nonce-encrypted',
      signingSecret: 'test-secret',
      timestamp: '1700000000',
    });
    const runEvent = vi.fn(async () => undefined);

    await expect(handleFeishuCallback({
      body: encryptedBody,
      payloadBody: unwrapFeishuCallbackBody({
        body: encryptedBody,
        encryptKey: 'encrypt-key',
      }),
      headers: {
        'x-lark-request-timestamp': '1700000000',
        'x-lark-request-nonce': 'nonce-encrypted',
        'x-lark-signature': signature,
      },
      signingSecret: 'test-secret',
      runEvent,
    })).resolves.toEqual({ kind: 'accepted', eventId: 'event-encrypted-run' });

    expect(runEvent).toHaveBeenCalledTimes(1);
    expect(runEvent).toHaveBeenCalledWith(expect.objectContaining({
      header: {
        event_id: 'event-encrypted-run',
        event_type: 'im.message.receive_v1',
      },
    }));
  });
});
