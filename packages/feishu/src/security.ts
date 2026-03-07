import { createDecipheriv, createHash, createHmac } from 'node:crypto';
import { processedEventIds } from '@agent-im-relay/core';

type FeishuHeaders = Record<string, string | undefined>;
const inFlightEventIds = new Set<string>();

type FeishuCallbackPayload = {
  header: {
    event_id: string;
    event_type: string;
  };
  event?: Record<string, unknown>;
  action?: Record<string, unknown>;
};

type FeishuCallbackRunEventResult = void | {
  deferred: Promise<void>;
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

type FeishuEncryptionEnvelope = {
  encrypt: string;
};

function parseEncryptedEnvelope(body: string): FeishuEncryptionEnvelope | null {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (typeof parsed.encrypt !== 'string') {
      return null;
    }

    return {
      encrypt: parsed.encrypt,
    };
  } catch {
    return null;
  }
}

export function unwrapFeishuCallbackBody(options: {
  body: string;
  encryptKey?: string;
}): string {
  const envelope = parseEncryptedEnvelope(options.body);
  if (!envelope) {
    return options.body;
  }

  if (!options.encryptKey) {
    throw new Error('Encrypted Feishu callback received without FEISHU_ENCRYPT_KEY.');
  }

  const encryptedBuffer = Buffer.from(envelope.encrypt, 'base64');
  if (encryptedBuffer.byteLength <= 16) {
    throw new Error('Malformed encrypted Feishu callback payload.');
  }

  const iv = encryptedBuffer.subarray(0, 16);
  const ciphertext = encryptedBuffer.subarray(16);
  const key = createHash('sha256').update(options.encryptKey).digest();

  try {
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    decipher.setAutoPadding(true);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf-8');
  } catch (error) {
    throw new Error(
      `Failed to decrypt Feishu callback payload: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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
    return false;
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
  payloadBody?: string;
  headers: FeishuHeaders;
  signingSecret: string;
  runEvent: (payload: FeishuCallbackPayload) => Promise<FeishuCallbackRunEventResult>;
}): Promise<{ kind: 'accepted' | 'duplicate'; eventId: string }> {
  if (!validateFeishuSignature({
    headers: options.headers,
    body: options.body,
    signingSecret: options.signingSecret,
  })) {
    throw new Error('Invalid Feishu signature.');
  }

  const payload = parseFeishuCallbackPayload(options.payloadBody ?? options.body);
  const eventId = payload.header.event_id;
  if (processedEventIds.has(eventId) || inFlightEventIds.has(eventId)) {
    return { kind: 'duplicate', eventId };
  }

  inFlightEventIds.add(eventId);
  let deferred: Promise<void> | undefined;
  try {
    const result = await options.runEvent(payload);
    deferred = result && typeof result === 'object' && 'deferred' in result
      ? result.deferred
      : undefined;

    if (!deferred) {
      processedEventIds.add(eventId);
    }

    return { kind: 'accepted', eventId };
  } finally {
    if (deferred) {
      void deferred
        .then(() => {
          processedEventIds.add(eventId);
        })
        .catch(() => undefined)
        .finally(() => {
          inFlightEventIds.delete(eventId);
        });
    } else {
      inFlightEventIds.delete(eventId);
    }
  }
}
