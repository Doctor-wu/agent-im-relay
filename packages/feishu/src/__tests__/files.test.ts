import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeRelayConfig(homeDir: string): Promise<void> {
  const relayDir = path.join(homeDir, '.agent-inbox');
  await mkdir(relayDir, { recursive: true });
  await writeFile(path.join(relayDir, 'config.jsonl'), [
    '{"type":"meta","version":1}',
    '{"type":"im","id":"feishu","enabled":true,"config":{"appId":"test-app","appSecret":"test-secret"}}',
  ].join('\n'), 'utf-8');
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await rm(dir, { recursive: true, force: true });
  }));
});

describe('Feishu files adapter', () => {
  it('downloads inbound Feishu files into conversation storage', async () => {
    const homeDir = await createTempDir('feishu-files-');
    vi.stubEnv('HOME', homeDir);
    await writeRelayConfig(homeDir);

    const { ingestFeishuFiles } = await import('../files.js');

    const downloaded = await ingestFeishuFiles({
      conversationId: 'feishu-conv',
      sourceMessageId: 'msg-1',
      files: [
        {
          fileKey: 'file-key-1',
          name: 'brief.txt',
          url: 'https://example.com/brief.txt',
          contentType: 'text/plain',
          size: 12,
        },
      ],
      fetchImpl: vi.fn(async () => new Response('hello world\n', { status: 200 })),
    });

    expect(downloaded).toEqual([
      expect.objectContaining({
        filename: 'brief.txt',
        relativePath: 'incoming/brief.txt',
      }),
    ]);
  });

  it('prepares Feishu outbound artifact uploads and surfaces warnings', async () => {
    const tempRoot = await createTempDir('feishu-upload-');
    const artifactsBaseDir = path.join(tempRoot, '.agent-inbox', 'artifacts');
    const cwd = path.join(tempRoot, 'workspace');
    const generatedFile = path.join(cwd, 'reports', 'summary.md');
    vi.stubEnv('HOME', tempRoot);
    await writeRelayConfig(tempRoot);

    await mkdir(path.dirname(generatedFile), { recursive: true });
    await writeFile(generatedFile, '# Summary\n', 'utf-8');

    const uploader = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('upload failed'));

    const { uploadFeishuArtifacts } = await import('../files.js');
    const result = await uploadFeishuArtifacts({
      conversationId: 'feishu-out',
      cwd,
      sourceMessageId: 'msg-2',
      resultText: [
        'Done.',
        '```artifacts',
        '{"files":[{"path":"reports/summary.md"},{"path":"missing.txt"}]}',
        '```',
      ].join('\n'),
      uploader,
    });

    expect(uploader).toHaveBeenCalledWith(expect.objectContaining({
      filePath: path.join(artifactsBaseDir, 'feishu-out', 'outgoing', 'summary.md'),
    }));
    expect(result.uploaded).toHaveLength(1);
    expect(result.warnings).toEqual([
      expect.stringContaining('Skipped artifact `missing.txt`'),
    ]);
  });
});
