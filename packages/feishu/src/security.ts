import { createHmac } from 'node:crypto';
import { processedEventIds } from '@agent-im-relay/core';

type FeishuHeaders = Record<string, string | undefined>;

type FeishuCallbackPayload = {
  header: {
    event_id: string;
    event_type: string;
  };
  event?: Record<string, unknown>;
  action?: Record<string, unknown>;
};

export function createFeishuSignature(options: {
  timestamp: string;
  nonce: string;
  body: string;
  signingSecret: string;
}): string {
  return createHmac('sha256', options.signingSecret)
    .update(`${options.timestamp}:${options.nonce}:${options.body}`)
    .digest('hex');
}

export function validateFeishuSignature(options: {
  headers: FeishuHeaders;
  body: string;
  signingSecret: string;
}): boolean {
  const timestamp = options.headers['x-lark-request-timestamp'];
  const nonce = options.headers['x-lark-request-nonce'];
  const signature = options.headers['x-lark-signature'];

  if (!timestamp || !nonce || !signature) {
    return true;
  }

  return signature === createFeishuSignature({
    timestamp,
    nonce,
    body: options.body,
    signingSecret: options.signingSecret,
  });
}

export function parseFeishuCallbackPayload(body: string): FeishuCallbackPayload {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  const header = parsed.header;
  if (
    typeof header !== 'object'
    || header === null
    || typeof (header as Record<string, unknown>).event_id !== 'string'
    || typeof (header as Record<string, unknown>).event_type !== 'string'
  ) {
    throw new Error('Malformed Feishu event payload.');
  }

  return {
    header: {
      event_id: (header as Record<string, string>).event_id,
      event_type: (header as Record<string, string>).event_type,
    },
    event: typeof parsed.event === 'object' && parsed.event !== null ? parsed.event as Record<string, unknown> : undefined,
    action: typeof parsed.action === 'object' && parsed.action !== null ? parsed.action as Record<string, unknown> : undefined,
  };
}

export async function handleFeishuCallback(options: {
  body: string;
  headers: FeishuHeaders;
  signingSecret: string;
  runEvent: (payload: FeishuCallbackPayload) => Promise<void>;
}): Promise<{ kind: 'accepted' | 'duplicate'; eventId: string }> {
  if (!validateFeishuSignature({
    headers: options.headers,
    body: options.body,
    signingSecret: options.signingSecret,
  })) {
    throw new Error('Invalid Feishu signature.');
  }

  const payload = parseFeishuCallbackPayload(options.body);
  const eventId = payload.header.event_id;
  if (processedEventIds.has(eventId)) {
    return { kind: 'duplicate', eventId };
  }

  processedEventIds.add(eventId);
  await options.runEvent(payload);
  return { kind: 'accepted', eventId };
}
