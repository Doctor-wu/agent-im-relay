import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { createFeishuCallbackHandler } from '../server.js';
import type { FeishuConfig } from '../config.js';
import { resetConversationRuntimeForTests } from '@agent-im-relay/core';
import { createFeishuSignature } from '../security.js';

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
    expect(replyMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'message-1',
      msgType: 'interactive',
    }));
  });
});
