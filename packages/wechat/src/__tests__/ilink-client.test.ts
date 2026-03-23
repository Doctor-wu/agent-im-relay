import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ILinkClientEvent, ILinkMessage } from '../types';
import type { WeChatConfig } from '../config';
import { ILinkClient } from '../ilink-client';

const baseConfig: WeChatConfig = {
  name: 'TestBot',
  sessionToken: undefined,
  reconnectMaxDelayMs: 30_000,
  heartbeatIntervalMs: 30_000,
  streamingCharThreshold: 500,
  streamingTimeThresholdMs: 3_000,
  selectionTimeoutMs: 10_000,
};

function makeMessage(id = '1'): ILinkMessage {
  return {
    msgId: id,
    type: 'text',
    content: 'hello',
    fromUser: 'user_001',
    fromUserName: 'Alice',
    toUser: 'bot',
    contextToken: 'ctx_abc',
    timestamp: Date.now(),
  };
}

/** Flush microtask queue so resolved promises propagate */
const flushMicrotasks = () => vi.advanceTimersByTimeAsync(0);

describe('ILinkClient — connect with cached session token', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('uses a cached sessionToken to skip QR auth', async () => {
    const config: WeChatConfig = { ...baseConfig, sessionToken: 'tok_cached' };
    const events: ILinkClientEvent[] = [];
    const msg = makeMessage();

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, data: { messages: [msg], nextPollMs: 0 } }),
      })
      // Second call: never resolves — will be broken by disconnect via Promise.race
      .mockReturnValue(new Promise(() => {}));

    const client = new ILinkClient(config, mockFetch);
    client.onEvent((e) => events.push(e));

    const connectPromise = client.connect();

    // Let the first poll resolve and deliver message
    await flushMicrotasks();

    expect(events.filter((e) => e.type === 'qr_code')).toHaveLength(0);
    expect(events.find((e) => e.type === 'connected')).toBeDefined();
    expect(events.filter((e) => e.type === 'message')).toHaveLength(1);

    // disconnect rejects the race promise, breaking pollLoop
    client.disconnect();
    await connectPromise;
  });
});

describe('ILinkClient — connect without session token (QR auth)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('emits qr_code event and then connected after scan', async () => {
    const qrData = { qrCodeUrl: 'https://ilink/qr/x', expireSeconds: 120 };
    const events: ILinkClientEvent[] = [];

    const mockFetch = vi.fn()
      // QR code request
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, data: qrData }),
      })
      // Poll for scan — confirmed immediately
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: { status: 'confirmed', sessionToken: 'tok_new_from_qr' },
        }),
      })
      // First long-poll returns empty messages
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, data: { messages: [], nextPollMs: 0 } }),
      })
      // Subsequent: hang forever (broken by disconnect)
      .mockReturnValue(new Promise(() => {}));

    const client = new ILinkClient(baseConfig, mockFetch);
    client.onEvent((e) => events.push(e));

    const connectPromise = client.connect();
    await flushMicrotasks();

    expect(events.some((e) => e.type === 'qr_code')).toBe(true);
    expect(events.some((e) => e.type === 'connected')).toBe(true);
    expect(client.getSessionToken()).toBe('tok_new_from_qr');

    client.disconnect();
    await connectPromise;
  });
});

describe('ILinkClient — long-poll message delivery', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('delivers messages via onEvent callback', async () => {
    const config: WeChatConfig = { ...baseConfig, sessionToken: 'tok_abc' };
    const msg = makeMessage('msg-42');
    const events: ILinkClientEvent[] = [];

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, data: { messages: [msg], nextPollMs: 0 } }),
      })
      .mockReturnValue(new Promise(() => {}));

    const client = new ILinkClient(config, mockFetch);
    client.onEvent((e) => events.push(e));

    const connectPromise = client.connect();
    await flushMicrotasks();

    const msgEvents = events.filter((e) => e.type === 'message');
    expect(msgEvents).toHaveLength(1);
    expect((msgEvents[0] as Extract<ILinkClientEvent, { type: 'message' }>).data.msgId).toBe('msg-42');

    client.disconnect();
    await connectPromise;
  });
});

describe('ILinkClient — backoff sequence', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('backs off with doubling delays: 1s → 2s → 4s → 8s → 16s → 30s cap', async () => {
    const config: WeChatConfig = { ...baseConfig, sessionToken: 'tok_backoff', reconnectMaxDelayMs: 30_000 };

    // Every long-poll call fails (network error)
    const mockFetch = vi.fn().mockRejectedValue(new Error('network error'));

    const client = new ILinkClient(config, mockFetch);
    const connectPromise = client.connect();

    // Let initial attempt fire
    await flushMicrotasks();

    // Advance through each backoff delay
    const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
    for (const delay of expectedDelays) {
      await vi.advanceTimersByTimeAsync(delay);
    }

    client.disconnect();
    await connectPromise;

    // initial + 6 retries = at least 7 calls
    // First call is the connected event poll, each error triggers a retry after sleep
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(6);
  });
});

describe('ILinkClient — backoff resets after success', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resets backoff delay to 1s after a successful poll', async () => {
    const config: WeChatConfig = { ...baseConfig, sessionToken: 'tok_reset', reconnectMaxDelayMs: 30_000 };

    let attempt = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      attempt++;
      if (attempt === 1) throw new Error('fail');
      if (attempt === 2) {
        return {
          ok: true,
          json: async () => ({ code: 0, data: { messages: [], nextPollMs: 0 } }),
        };
      }
      throw new Error('fail again');
    });

    const client = new ILinkClient(config, mockFetch);
    const connectPromise = client.connect();

    // Let initial attempt fire + fail
    await flushMicrotasks();
    // Wait 1s for first backoff
    await vi.advanceTimersByTimeAsync(1_000);
    // Successful poll
    await flushMicrotasks();
    // Third attempt fails — next retry should be 1s (reset), not 2s
    await vi.advanceTimersByTimeAsync(1_000);

    expect(attempt).toBeGreaterThanOrEqual(3);

    client.disconnect();
    await connectPromise;
  });
});

describe('ILinkClient — heartbeat', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends heartbeat at the configured interval', async () => {
    const config: WeChatConfig = {
      ...baseConfig,
      sessionToken: 'tok_hb',
      heartbeatIntervalMs: 5_000,
    };

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('heartbeat')) {
        return { ok: true, json: async () => ({ code: 0 }) };
      }
      // Long-poll: hang (will be broken by disconnect race)
      return new Promise(() => {});
    });

    const client = new ILinkClient(config, mockFetch);
    const connectPromise = client.connect();

    // Flush connect, then advance past 3 heartbeat intervals
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);

    const heartbeatCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      url.includes('heartbeat'),
    );
    expect(heartbeatCalls.length).toBeGreaterThanOrEqual(2);

    client.disconnect();
    await connectPromise;
  });
});

describe('ILinkClient — disconnect', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('stops polling and heartbeat after disconnect()', async () => {
    const config: WeChatConfig = { ...baseConfig, sessionToken: 'tok_dc', heartbeatIntervalMs: 1_000 };
    const events: ILinkClientEvent[] = [];

    const mockFetch = vi.fn().mockReturnValue(new Promise(() => {}));

    const client = new ILinkClient(config, mockFetch);
    client.onEvent((e) => events.push(e));

    const connectPromise = client.connect();
    await flushMicrotasks();

    const callsBefore = mockFetch.mock.calls.length;
    client.disconnect();
    await connectPromise;

    // Advance time — no more calls should happen
    await vi.advanceTimersByTimeAsync(10_000);
    const callsAfter = mockFetch.mock.calls.length;

    expect(callsAfter).toBe(callsBefore);
    expect(events.some((e) => e.type === 'disconnected')).toBe(true);
  });
});
