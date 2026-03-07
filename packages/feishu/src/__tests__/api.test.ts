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
});
