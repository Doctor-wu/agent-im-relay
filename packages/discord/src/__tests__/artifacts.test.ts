import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'discord-artifacts-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await rm(dir, { recursive: true, force: true });
  }));
});

describe('publishConversationArtifacts', () => {
  it('uploads valid artifact files and records outgoing metadata', async () => {
    const tempRoot = await createTempDir();
    const cwd = path.join(tempRoot, 'workspace');
    const artifactsBaseDir = path.join(tempRoot, 'artifacts');
    const generatedFile = path.join(cwd, 'reports', 'summary.md');
    vi.stubEnv('ARTIFACTS_BASE_DIR', artifactsBaseDir);

    await mkdir(path.dirname(generatedFile), { recursive: true });
    await writeFile(generatedFile, '# Summary\n', 'utf-8');

    const { publishConversationArtifacts } = await import('../artifacts.js');
    const { getConversationArtifactMetadata } = await import('@agent-im-relay/core');
    const send = vi.fn().mockResolvedValue({});

    await publishConversationArtifacts({
      conversationId: 'thread-1',
      cwd,
      resultText: [
        'Done.',
        '```artifacts',
        '{ "files": [{ "path": "reports/summary.md", "title": "Summary" }] }',
        '```',
      ].join('\n'),
      channel: { send },
    });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Returned 1 file'),
      files: [path.join(artifactsBaseDir, 'thread-1', 'outgoing', 'summary.md')],
    }));
    await expect(getConversationArtifactMetadata('thread-1')).resolves.toEqual(expect.objectContaining({
      outgoing: [
        expect.objectContaining({
          filename: 'summary.md',
          relativePath: 'outgoing/summary.md',
          title: 'Summary',
        }),
      ],
    }));
  });

  it('ignores invalid artifact paths and reports a warning', async () => {
    const tempRoot = await createTempDir();
    const cwd = path.join(tempRoot, 'workspace');
    const artifactsBaseDir = path.join(tempRoot, 'artifacts');
    vi.stubEnv('ARTIFACTS_BASE_DIR', artifactsBaseDir);

    await mkdir(cwd, { recursive: true });

    const { publishConversationArtifacts } = await import('../artifacts.js');
    const send = vi.fn().mockResolvedValue({});

    await publishConversationArtifacts({
      conversationId: 'thread-2',
      cwd,
      resultText: [
        'Done.',
        '```artifacts',
        '{ "files": [{ "path": "../secret.txt" }] }',
        '```',
      ].join('\n'),
      channel: { send },
    });

    expect(send).toHaveBeenCalledWith(expect.stringContaining('Skipped artifact `../secret.txt`'));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reports upload failures without dropping the saved artifact copy', async () => {
    const tempRoot = await createTempDir();
    const cwd = path.join(tempRoot, 'workspace');
    const artifactsBaseDir = path.join(tempRoot, 'artifacts');
    const generatedFile = path.join(cwd, 'reports', 'summary.md');
    vi.stubEnv('ARTIFACTS_BASE_DIR', artifactsBaseDir);

    await mkdir(path.dirname(generatedFile), { recursive: true });
    await writeFile(generatedFile, '# Summary\n', 'utf-8');

    const { publishConversationArtifacts } = await import('../artifacts.js');
    const { getConversationArtifactMetadata } = await import('@agent-im-relay/core');
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockResolvedValueOnce({});

    await publishConversationArtifacts({
      conversationId: 'thread-3',
      cwd,
      resultText: [
        'Done.',
        '```artifacts',
        '{ "files": [{ "path": "reports/summary.md" }] }',
        '```',
      ].join('\n'),
      channel: { send },
    });

    expect(send).toHaveBeenNthCalledWith(2, expect.stringContaining('Failed to upload returned files'));
    await expect(getConversationArtifactMetadata('thread-3')).resolves.toEqual(expect.objectContaining({
      outgoing: [
        expect.objectContaining({
          filename: 'summary.md',
          relativePath: 'outgoing/summary.md',
        }),
      ],
    }));
  });

  it('skips oversized artifact uploads and reports the limit hit', async () => {
    const tempRoot = await createTempDir();
    const cwd = path.join(tempRoot, 'workspace');
    const artifactsBaseDir = path.join(tempRoot, 'artifacts');
    const generatedFile = path.join(cwd, 'reports', 'summary.md');
    vi.stubEnv('ARTIFACTS_BASE_DIR', artifactsBaseDir);
    vi.stubEnv('ARTIFACT_MAX_SIZE_BYTES', '4');

    await mkdir(path.dirname(generatedFile), { recursive: true });
    await writeFile(generatedFile, '# Summary\n', 'utf-8');

    const { publishConversationArtifacts } = await import('../artifacts.js');
    const send = vi.fn().mockResolvedValue({});

    await publishConversationArtifacts({
      conversationId: 'thread-4',
      cwd,
      resultText: [
        'Done.',
        '```artifacts',
        '{ "files": [{ "path": "reports/summary.md" }] }',
        '```',
      ].join('\n'),
      channel: { send },
    });

    expect(send).toHaveBeenCalledWith(expect.stringContaining('exceeds max size'));
    expect(send).toHaveBeenCalledTimes(1);
  });
});
