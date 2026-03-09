import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFeishuClient } from '../api.js';

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async dir => rm(dir, { recursive: true, force: true })));
});

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
    feishuAppSecret: 'app-secret',
    feishuBaseUrl: 'https://open.feishu.cn',
    feishuPort: 3001,
  };
}

describe('Feishu API client', () => {
  it('caches tenant access tokens', async () => {
    let currentTime = 1_000;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      tenant_access_token: 'tenant-token',
      expire: 120,
    }), { status: 200 }));

    const client = createFeishuClient(testConfig(), {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => currentTime,
    });

    await expect(client.getTenantAccessToken()).resolves.toBe('tenant-token');
    currentTime += 10_000;
    await expect(client.getTenantAccessToken()).resolves.toBe('tenant-token');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends text messages', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        tenant_access_token: 'tenant-token',
        expire: 120,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { message_id: 'message-1' },
      }), { status: 200 }));

    const client = createFeishuClient(testConfig(), { fetchImpl: fetchImpl as typeof fetch });

    await expect(client.sendMessage({
      receiveId: 'chat-1',
      msgType: 'text',
      content: JSON.stringify({ text: 'hello' }),
    })).resolves.toBe('message-1');
  });

  it('sends post messages', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        tenant_access_token: 'tenant-token',
        expire: 120,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { message_id: 'message-post-1' },
      }), { status: 200 }));

    const client = createFeishuClient(testConfig(), { fetchImpl: fetchImpl as typeof fetch });
    const content = JSON.stringify({
      zh_cn: {
        title: '',
        content: [[{ tag: 'text', text: '【Summary】' }]],
      },
    });

    await expect(client.sendMessage({
      receiveId: 'chat-1',
      msgType: 'post',
      content,
    })).resolves.toBe('message-post-1');

    expect(fetchImpl).toHaveBeenLastCalledWith(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          receive_id: 'chat-1',
          msg_type: 'post',
          content,
        }),
      }),
    );
  });

  it('creates a session group chat with the bot and one target user', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        tenant_access_token: 'tenant-token',
        expire: 120,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          chat_id: 'chat-session-1',
          name: 'Alice · Fix relay startup · a1f4',
        },
      }), { status: 200 }));

    const client = createFeishuClient(testConfig(), { fetchImpl: fetchImpl as typeof fetch });

    await expect(client.createSessionChat({
      name: 'Alice · Fix relay startup · a1f4',
      userOpenId: 'ou_user_1',
    })).resolves.toEqual({
      chatId: 'chat-session-1',
      name: 'Alice · Fix relay startup · a1f4',
    });

    expect(fetchImpl).toHaveBeenLastCalledWith(
      'https://open.feishu.cn/open-apis/im/v1/chats?user_id_type=open_id',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tenant-token',
          'content-type': 'application/json; charset=utf-8',
        }),
        body: JSON.stringify({
          name: 'Alice · Fix relay startup · a1f4',
          user_id_list: ['ou_user_1'],
          chat_mode: 'group',
          chat_type: 'private',
        }),
      }),
    );
  });

  it('sends a native shared-chat message into the private launcher chat', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        tenant_access_token: 'tenant-token',
        expire: 120,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { message_id: 'message-index-1' },
      }), { status: 200 }));

    const client = createFeishuClient(testConfig(), { fetchImpl: fetchImpl as typeof fetch });

    await expect(client.sendSharedChatMessage({
      receiveId: 'p2p-chat-1',
      chatId: 'session-chat-1',
    })).resolves.toBe('message-index-1');

    expect(fetchImpl).toHaveBeenLastCalledWith(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tenant-token',
          'content-type': 'application/json; charset=utf-8',
        }),
        body: JSON.stringify({
          receive_id: 'p2p-chat-1',
          msg_type: 'share_chat',
          content: JSON.stringify({ chat_id: 'session-chat-1' }),
        }),
      }),
    );
  });

  it('does not expose the removed private-chat index helper', () => {
    const client = createFeishuClient(testConfig(), {
      fetchImpl: vi.fn() as typeof fetch,
    });

    expect('sendPrivateChatIndexMessage' in client).toBe(false);
  });

  it('keeps existing text, card, and file message helpers intact', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        tenant_access_token: 'tenant-token',
        expire: 120,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { message_id: 'message-text-1' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { message_id: 'message-card-1' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { message_id: 'message-file-1' },
      }), { status: 200 }));

    const client = createFeishuClient(testConfig(), { fetchImpl: fetchImpl as typeof fetch });

    await expect(client.sendMessage({
      receiveId: 'chat-1',
      msgType: 'text',
      content: JSON.stringify({ text: 'hello again' }),
    })).resolves.toBe('message-text-1');

    await expect(client.sendCard('chat-1', {
      schema: '2.0',
      body: { elements: [] },
    })).resolves.toBe('message-card-1');

    await expect(client.sendFileMessage('chat-1', 'file-key-1')).resolves.toBe('message-file-1');
  });

  it('replies with post messages', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        tenant_access_token: 'tenant-token',
        expire: 120,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { message_id: 'message-reply-1' },
      }), { status: 200 }));

    const client = createFeishuClient(testConfig(), { fetchImpl: fetchImpl as typeof fetch });
    const content = JSON.stringify({
      zh_cn: {
        title: '',
        content: [[{ tag: 'text', text: 'Reply body' }]],
      },
    });

    await expect(client.replyMessage({
      messageId: 'message-1',
      msgType: 'post',
      content,
    })).resolves.toBe('message-reply-1');

    expect(fetchImpl).toHaveBeenLastCalledWith(
      'https://open.feishu.cn/open-apis/im/v1/messages/message-1/reply',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          msg_type: 'post',
          content,
        }),
      }),
    );
  });

  it('updates interactive card messages in place', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        tenant_access_token: 'tenant-token',
        expire: 120,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
      }), { status: 200 }));

    const client = createFeishuClient(testConfig(), { fetchImpl: fetchImpl as typeof fetch });

    await expect(client.updateCardMessage('message-card-1', {
      schema: '2.0',
      body: { elements: [] },
    })).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenLastCalledWith(
      'https://open.feishu.cn/open-apis/im/v1/messages/message-card-1',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: 'Bearer tenant-token',
          'content-type': 'application/json; charset=utf-8',
        }),
        body: JSON.stringify({
          msg_type: 'interactive',
          content: JSON.stringify({
            schema: '2.0',
            body: { elements: [] },
          }),
        }),
      }),
    );
  });

  it('uploads files and returns file key', async () => {
    const tempDir = await createTempDir('feishu-api-');
    const filePath = path.join(tempDir, 'summary.txt');
    await writeFile(filePath, 'hello', 'utf-8');

    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        tenant_access_token: 'tenant-token',
        expire: 120,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { file_key: 'file-key-1' },
      }), { status: 200 }));

    const client = createFeishuClient(testConfig(), { fetchImpl: fetchImpl as typeof fetch });
    await expect(client.uploadFile({
      filePath,
      fileName: 'summary.txt',
    })).resolves.toBe('file-key-1');
  });

  it('downloads image resources with the image resource type', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        tenant_access_token: 'tenant-token',
        expire: 120,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('image-bytes', {
        status: 200,
        headers: {
          'content-type': 'image/png',
        },
      }));

    const client = createFeishuClient(testConfig(), { fetchImpl: fetchImpl as typeof fetch });
    const response = await client.downloadMessageResource('message-1', 'image-key-1', 'image');

    expect(response.ok).toBe(true);
    expect(fetchImpl).toHaveBeenLastCalledWith(
      'https://open.feishu.cn/open-apis/im/v1/messages/message-1/resources/image-key-1?type=image',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer tenant-token',
        }),
      }),
    );
  });
});
