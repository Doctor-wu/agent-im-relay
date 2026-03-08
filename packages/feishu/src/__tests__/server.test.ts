import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import type { FeishuConfig } from '../config.js';
import { resetConversationRuntimeForTests } from '@agent-im-relay/core';
import { createFeishuSignature } from '../security.js';

const runtimeMocks = vi.hoisted(() => ({
  runFeishuConversation: vi.fn(),
}));

vi.mock('../runtime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime.js')>();
  return {
    ...actual,
    runFeishuConversation: runtimeMocks.runFeishuConversation,
  };
});

import { createFeishuCallbackHandler } from '../server.js';

function sign(body: string, timestamp: string, nonce: string): string {
  return createFeishuSignature({
    timestamp,
    nonce,
    body,
    signingSecret: 'test-secret',
  });
}

async function createConfig(): Promise<FeishuConfig> {
  const tempDir = await mkdtemp(join('/tmp', 'agent-inbox-feishu-'));

  return {
    agentTimeoutMs: 1_000,
    claudeCwd: process.cwd(),
    stateFile: join(tempDir, 'state', 'sessions.json'),
    artifactsBaseDir: join(tempDir, 'artifacts'),
    artifactRetentionDays: 14,
    artifactMaxSizeBytes: 8 * 1024 * 1024,
    claudeBin: 'claude',
    codexBin: 'codex',
    feishuAppId: 'test-app-id',
    feishuAppSecret: 'test-secret',
    feishuBaseUrl: 'https://open.feishu.cn',
    feishuPort: 3001,
  };
}

afterEach(() => {
  runtimeMocks.runFeishuConversation.mockReset();
  resetConversationRuntimeForTests();
});

describe('Feishu callback handler', () => {
  it('handles URL verification', async () => {
    const handler = createFeishuCallbackHandler(await createConfig(), {
      client: {} as never,
    });

    const response = await handler({
      method: 'POST',
      url: '/feishu/callback',
      headers: {},
      body: JSON.stringify({
        type: 'url_verification',
        challenge: 'verify-me',
      }),
    });

    expect(response.status).toBe(200);
    expect(response.body).toBe(JSON.stringify({ challenge: 'verify-me' }));
  });

  it('responds to a message by presenting backend selection in single-process mode', async () => {
    runtimeMocks.runFeishuConversation.mockResolvedValue({ kind: 'blocked' });
    const replyMessage = vi.fn(async () => {});
    const handler = createFeishuCallbackHandler(await createConfig(), {
      client: {
        replyMessage,
      } as never,
    });

    const body = JSON.stringify({
      event: {
        sender: { sender_id: { open_id: 'user-1' } },
        message: {
          message_id: 'message-1',
          chat_id: 'chat-1',
          chat_type: 'group',
          mentions: [{ key: '@_user_1', id: { open_id: 'bot-open-id' }, name: 'relay-bot' }],
          content: JSON.stringify({ text: '@_user_1 hello bot' }),
        },
      },
      header: {
        event_id: 'event-1',
        token: 'token',
        create_time: String(Date.now()),
        event_type: 'im.message.receive_v1',
      },
    });
    const timestamp = String(Date.now());

    const response = await handler({
      method: 'POST',
      url: '/feishu/callback',
      headers: {
        'x-lark-request-timestamp': timestamp,
        'x-lark-request-nonce': 'nonce-1',
        'x-lark-signature': sign(body, timestamp, 'nonce-1'),
      },
      body,
    });

    expect(response.status).toBe(200);
    await vi.waitFor(() => {
      expect(runtimeMocks.runFeishuConversation).toHaveBeenCalledWith(expect.objectContaining({
        conversationId: 'chat-1',
        prompt: 'hello bot',
      }));
    });
  });

  it('acknowledges the callback before a long-running conversation finishes', async () => {
    let resolveRun: ((value: { kind: 'started' }) => void) | undefined;
    runtimeMocks.runFeishuConversation.mockImplementation(() => new Promise((resolve) => {
      resolveRun = resolve as (value: { kind: 'started' }) => void;
    }));

    const handler = createFeishuCallbackHandler(await createConfig(), {
      client: {
        replyMessage: vi.fn(async () => {}),
      } as never,
    });

    const body = JSON.stringify({
      event: {
        sender: { sender_id: { open_id: 'user-1' } },
        message: {
          message_id: 'message-2',
          chat_id: 'chat-2',
          chat_type: 'group',
          mentions: [{ key: '@_user_1', id: { open_id: 'bot-open-id' }, name: 'relay-bot' }],
          content: JSON.stringify({ text: '@_user_1 hello bot' }),
        },
      },
      header: {
        event_id: 'event-2',
        token: 'token',
        create_time: String(Date.now()),
        event_type: 'im.message.receive_v1',
      },
    });
    const timestamp = String(Date.now());

    const response = await Promise.race([
      handler({
        method: 'POST',
        url: '/feishu/callback',
        headers: {
          'x-lark-request-timestamp': timestamp,
          'x-lark-request-nonce': 'nonce-2',
          'x-lark-signature': sign(body, timestamp, 'nonce-2'),
        },
        body,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('callback was not acknowledged promptly')), 50);
      }),
    ]);

    expect(response.status).toBe(200);
    expect(response.body).toBe(JSON.stringify({ code: 0 }));
    await vi.waitFor(() => {
      expect(runtimeMocks.runFeishuConversation).toHaveBeenCalledOnce();
    });
    expect(resolveRun).toBeTypeOf('function');

    resolveRun?.({ kind: 'started' });
  });
});
