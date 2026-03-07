import { describe, expect, it, vi } from 'vitest';
import { createFeishuSignature } from '../security.js';
import { createFeishuCallbackHandler } from '../server.js';

function testConfig() {
  return {
    agentTimeoutMs: 1_000,
    claudeCwd: process.cwd(),
    stateFile: '/tmp/feishu-state.json',
    artifactsBaseDir: '/tmp/feishu-artifacts',
    artifactRetentionDays: 14,
    artifactMaxSizeBytes: 8 * 1024 * 1024,
    claudeBin: '/opt/homebrew/bin/claude',
    codexBin: '/opt/homebrew/bin/codex',
    feishuAppId: 'app-id',
    feishuAppSecret: 'test-secret',
    feishuVerificationToken: 'verify-token',
    feishuBaseUrl: 'https://open.feishu.cn',
    feishuPort: 3001,
    feishuClientId: 'client-a',
    feishuClientToken: 'client-token',
  };
}

function signedRequest(body: string, nonce: string) {
  return {
    method: 'POST',
    url: '/feishu/callback',
    headers: {
      'x-lark-request-timestamp': '1700000000',
      'x-lark-request-nonce': nonce,
      'x-lark-signature': createFeishuSignature({
        body,
        nonce,
        signingSecret: 'test-secret',
        timestamp: '1700000000',
      }),
    },
    body,
  };
}

describe('Feishu callback handler', () => {
  it('handles URL verification', async () => {
    const handler = createFeishuCallbackHandler(testConfig(), {
      client: {} as any,
    });

    const response = await handler({
      method: 'POST',
      url: '/feishu/callback',
      headers: {},
      body: JSON.stringify({
        type: 'url_verification',
        token: 'verify-token',
        challenge: 'challenge-1',
      }),
    });

    expect(response.status).toBe(200);
    expect(response.body).toContain('challenge-1');
  });

  it('routes text messages into the managed bridge instead of executing locally', async () => {
    const bridge = {
      dispatchRunCommand: vi.fn(() => ({
        kind: 'queued',
        clientId: 'client-a',
        requestId: 'request-1',
      })),
      dispatchControlCommand: vi.fn(),
      registerClient: vi.fn(),
      pullCommands: vi.fn(),
      consumeClientEvent: vi.fn(),
      queueAttachments: vi.fn(),
    };
    const handler = createFeishuCallbackHandler(testConfig(), {
      client: {
        sendMessage: vi.fn(async () => undefined),
        replyMessage: vi.fn(async () => undefined),
        sendCard: vi.fn(async () => undefined),
        uploadFile: vi.fn(async () => 'file-key'),
        uploadFileContent: vi.fn(async () => 'file-key'),
        sendFileMessage: vi.fn(async () => undefined),
        getTenantAccessToken: vi.fn(async () => 'tenant-token'),
        downloadMessageResource: vi.fn(),
      } as any,
      bridge: bridge as any,
    });

    const body = JSON.stringify({
      header: {
        event_id: 'event-message',
        event_type: 'im.message.receive_v1',
      },
      event: {
        message: {
          chat_id: 'chat-1',
          chat_type: 'p2p',
          message_id: 'message-1',
          message_type: 'text',
          content: JSON.stringify({ text: 'hello bot' }),
        },
      },
    });

    const response = await handler(signedRequest(body, 'nonce-1'));

    expect(response.status).toBe(200);
    expect(bridge.dispatchRunCommand).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'chat-1',
      prompt: 'hello bot',
      mode: 'code',
    }));
  });

  it('routes card actions into managed control commands', async () => {
    const bridge = {
      dispatchRunCommand: vi.fn(),
      dispatchControlCommand: vi.fn(() => ({
        kind: 'queued',
        clientId: 'client-a',
        requestId: 'request-2',
      })),
      dispatchPendingRun: vi.fn(() => ({
        kind: 'missing',
        reason: 'setup-not-found',
      })),
      registerClient: vi.fn(),
      pullCommands: vi.fn(),
      consumeClientEvent: vi.fn(),
      queueAttachments: vi.fn(),
    };
    const handler = createFeishuCallbackHandler(testConfig(), {
      client: {
        sendMessage: vi.fn(async () => undefined),
        replyMessage: vi.fn(async () => undefined),
        sendCard: vi.fn(async () => undefined),
        uploadFile: vi.fn(async () => 'file-key'),
        uploadFileContent: vi.fn(async () => 'file-key'),
        sendFileMessage: vi.fn(async () => undefined),
        getTenantAccessToken: vi.fn(async () => 'tenant-token'),
        downloadMessageResource: vi.fn(),
      } as any,
      bridge: bridge as any,
    });

    const body = JSON.stringify({
      header: {
        event_id: 'event-action',
        event_type: 'im.message.action.trigger',
      },
      action: {
        value: {
          conversationId: 'conv-1',
          chatId: 'chat-1',
          action: 'backend',
          value: 'codex',
        },
      },
    });

    await handler(signedRequest(body, 'nonce-2'));

    expect(bridge.dispatchControlCommand).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-1',
      action: {
        conversationId: 'conv-1',
        type: 'backend',
        value: 'codex',
      },
    }));
    expect(bridge.dispatchPendingRun).toHaveBeenCalledWith('conv-1');
  });

  it('sends a clear fallback message when the relay client is offline', async () => {
    const replyMessage = vi.fn(async () => undefined);
    const bridge = {
      dispatchRunCommand: vi.fn(() => ({
        kind: 'offline',
        reason: 'client-offline',
      })),
      dispatchControlCommand: vi.fn(),
      registerClient: vi.fn(),
      pullCommands: vi.fn(),
      consumeClientEvent: vi.fn(),
      queueAttachments: vi.fn(),
    };
    const handler = createFeishuCallbackHandler(testConfig(), {
      client: {
        sendMessage: vi.fn(async () => undefined),
        replyMessage,
        sendCard: vi.fn(async () => undefined),
        uploadFile: vi.fn(async () => 'file-key'),
        uploadFileContent: vi.fn(async () => 'file-key'),
        sendFileMessage: vi.fn(async () => undefined),
        getTenantAccessToken: vi.fn(async () => 'tenant-token'),
        downloadMessageResource: vi.fn(),
      } as any,
      bridge: bridge as any,
    });

    const body = JSON.stringify({
      header: {
        event_id: 'event-offline',
        event_type: 'im.message.receive_v1',
      },
      event: {
        message: {
          chat_id: 'chat-1',
          chat_type: 'p2p',
          message_id: 'message-1',
          message_type: 'text',
          content: JSON.stringify({ text: 'hello bot' }),
        },
      },
    });

    await handler(signedRequest(body, 'nonce-3'));

    expect(replyMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'message-1',
      msgType: 'text',
      content: JSON.stringify({
        text: 'Relay client is offline. Start the local Feishu relay client and try again.',
      }),
    }));
  });

  it('replies cards and files to the original message target when bridge events arrive', async () => {
    const replyMessage = vi.fn(async () => undefined);
    const uploadFileContent = vi.fn(async () => 'file-key-bridge');
    const handler = createFeishuCallbackHandler(testConfig(), {
      client: {
        sendMessage: vi.fn(async () => undefined),
        replyMessage,
        sendCard: vi.fn(async () => undefined),
        uploadFile: vi.fn(async () => 'file-key'),
        uploadFileContent,
        sendFileMessage: vi.fn(async () => undefined),
        getTenantAccessToken: vi.fn(async () => 'tenant-token'),
        downloadMessageResource: vi.fn(),
      } as any,
    });

    await handler({
      method: 'POST',
      url: '/feishu/bridge/hello',
      headers: {},
      body: JSON.stringify({
        clientId: 'client-a',
        token: 'client-token',
      }),
    });

    const body = JSON.stringify({
      header: {
        event_id: 'event-bridge-reply',
        event_type: 'im.message.receive_v1',
      },
      event: {
        message: {
          chat_id: 'chat-1',
          chat_type: 'p2p',
          message_id: 'message-1',
          message_type: 'text',
          content: JSON.stringify({ text: 'hello bot' }),
        },
      },
    });

    await handler(signedRequest(body, 'nonce-4'));

    const pullResponse = await handler({
      method: 'POST',
      url: '/feishu/bridge/pull',
      headers: {},
      body: JSON.stringify({
        clientId: 'client-a',
        token: 'client-token',
        limit: 1,
      }),
    });
    const requestId = (JSON.parse(pullResponse.body) as {
      commands: Array<{ requestId: string }>;
    }).commands[0]?.requestId;

    await handler({
      method: 'POST',
      url: '/feishu/bridge/events',
      headers: {},
      body: JSON.stringify({
        clientId: 'client-a',
        token: 'client-token',
        event: {
          type: 'conversation.card',
          clientId: 'client-a',
          requestId,
          conversationId: 'chat-1',
          timestamp: '2026-03-07T00:00:01.000Z',
          payload: {
            card: {
              schema: '2.0',
              body: {
                elements: [],
              },
            },
          },
        },
      }),
    });

    await handler({
      method: 'POST',
      url: '/feishu/bridge/events',
      headers: {},
      body: JSON.stringify({
        clientId: 'client-a',
        token: 'client-token',
        event: {
          type: 'conversation.file',
          clientId: 'client-a',
          requestId,
          conversationId: 'chat-1',
          timestamp: '2026-03-07T00:00:02.000Z',
          payload: {
            fileName: 'result.txt',
            data: Buffer.from('artifact').toString('base64'),
          },
        },
      }),
    });

    expect(replyMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'message-1',
      msgType: 'interactive',
      content: JSON.stringify({
        schema: '2.0',
        body: {
          elements: [],
        },
      }),
    }));
    expect(uploadFileContent).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'result.txt',
    }));
    expect(replyMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'message-1',
      msgType: 'file',
      content: JSON.stringify({
        file_key: 'file-key-bridge',
      }),
    }));
  });
});
