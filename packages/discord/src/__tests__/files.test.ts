import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

async function createTempArtifactsDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'discord-files-'));
  tempDirs.push(dir);
  return dir;
}

async function setupDiscordRelayHome(
  baseDir: string,
  runtime: Record<string, unknown> = {},
): Promise<string> {
  const relayDir = path.join(baseDir, '.agent-inbox');
  vi.stubEnv('HOME', baseDir);
  vi.stubEnv('INIT_CWD', '');
  await mkdir(relayDir, { recursive: true });
  await writeFile(path.join(relayDir, 'config.jsonl'), [
    JSON.stringify({ type: 'meta', version: 1 }),
    JSON.stringify({ type: 'runtime', config: runtime }),
    JSON.stringify({
      type: 'im',
      id: 'discord',
      enabled: true,
      config: {
        token: 'test-token',
        clientId: 'test-client-id',
      },
    }),
  ].join('\n'), 'utf-8');
  return path.join(relayDir, 'artifacts');
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await rm(dir, { recursive: true, force: true });
  }));
});

describe('attachment downloads', () => {
  it('downloads Discord attachments into the conversation incoming directory and persists metadata', async () => {
    const tempRoot = await createTempArtifactsDir();
    const artifactsBaseDir = await setupDiscordRelayHome(tempRoot);

    const { downloadAttachments } = await import('../files.js');
    const { getConversationArtifactMetadata } = await import('@agent-im-relay/core');
    const fetchImpl = vi.fn(async () => new Response('# Spec\n\nFirst line\nSecond line\nThird line\n', { status: 200 }));

    const downloaded = await downloadAttachments({
      conversationId: 'thread-1',
      sourceMessageId: 'msg-1',
      attachments: [
        {
          id: 'att-1',
          name: 'spec.md',
          url: 'https://example.com/spec.md',
          contentType: 'text/markdown',
          size: 40,
        },
      ],
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith('https://example.com/spec.md');
    expect(downloaded).toHaveLength(1);
    expect(downloaded[0]).toEqual(expect.objectContaining({
      id: 'att-1',
      filename: 'spec.md',
      relativePath: 'incoming/spec.md',
      kind: 'markdown',
      sourceMessageId: 'msg-1',
      preview: ['# Spec', 'First line', 'Second line', 'Third line'],
      localPath: path.join(artifactsBaseDir, 'thread-1', 'incoming', 'spec.md'),
    }));
    await expect(readFile(downloaded[0]!.localPath, 'utf-8')).resolves.toBe('# Spec\n\nFirst line\nSecond line\nThird line\n');
    await expect(getConversationArtifactMetadata('thread-1')).resolves.toEqual({
      incoming: [
        expect.objectContaining({
          id: 'att-1',
          filename: 'spec.md',
          relativePath: 'incoming/spec.md',
          kind: 'markdown',
          sourceMessageId: 'msg-1',
          preview: ['# Spec', 'First line', 'Second line', 'Third line'],
        }),
      ],
      outgoing: [],
      lastUpdatedAt: expect.any(String),
    });
  });

  it('prepends local attachment context to the prompt when files were downloaded', async () => {
    const tempRoot = await createTempArtifactsDir();
    const artifactsBaseDir = await setupDiscordRelayHome(tempRoot);

    const { prepareAttachmentPrompt } = await import('../files.js');
    const fetchImpl = vi.fn(async () => new Response('alpha\nbeta\ngamma\n', { status: 200 }));

    const prepared = await prepareAttachmentPrompt({
      conversationId: 'thread-2',
      prompt: 'Summarize the upload',
      sourceMessageId: 'msg-2',
      attachments: [
        {
          id: 'att-2',
          name: 'notes.txt',
          url: 'https://example.com/notes.txt',
          contentType: 'text/plain',
          size: 17,
        },
      ],
      fetchImpl,
    });

    expect(prepared.attachments).toHaveLength(1);
    expect(prepared.prompt).toContain('Attached files are available locally for this run:');
    expect(prepared.prompt).toContain('- notes.txt | generic, 17 B | text/plain');
    expect(prepared.prompt).toContain(`path: ${path.join(artifactsBaseDir, 'thread-2', 'incoming', 'notes.txt')}`);
    expect(prepared.prompt).toContain('preview: alpha');
    expect(prepared.prompt).toContain('User request:\nSummarize the upload');
  });

  it('rejects oversized downloads before writing them to disk', async () => {
    const tempRoot = await createTempArtifactsDir();
    await setupDiscordRelayHome(tempRoot, {
      artifactMaxSizeBytes: 8,
    });

    const { downloadAttachments } = await import('../files.js');

    await expect(downloadAttachments({
      conversationId: 'thread-big',
      attachments: [
        {
          id: 'att-big',
          name: 'big.txt',
          url: 'https://example.com/big.txt',
          contentType: 'text/plain',
          size: 16,
        },
      ],
      fetchImpl: vi.fn(),
    })).rejects.toThrow(/exceeds max size/i);
  });
});
