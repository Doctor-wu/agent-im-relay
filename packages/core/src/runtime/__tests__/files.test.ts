import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
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

describe('shared runtime files', () => {
  it('builds a shared attachment prompt after downloading inbound files', async () => {
    const artifactsBaseDir = await createTempDir('core-files-');
    vi.stubEnv('ARTIFACTS_BASE_DIR', artifactsBaseDir);

    const { prepareAttachmentPrompt } = await import('../files.js');

    const prepared = await prepareAttachmentPrompt({
      conversationId: 'conv-files',
      prompt: 'Summarize it',
      sourceMessageId: 'msg-1',
      attachments: [
        {
          id: 'file-1',
          name: 'notes.md',
          url: 'https://example.com/notes.md',
          contentType: 'text/markdown',
          size: 14,
        },
      ],
      fetchImpl: vi.fn(async () => new Response('# Notes\nalpha\nbeta\n', { status: 200 })),
    });

    expect(prepared.attachments).toHaveLength(1);
    expect(prepared.prompt).toContain('Attached files are available locally for this run:');
    expect(prepared.prompt).toContain('notes.md');
    expect(prepared.prompt).toContain('preview: # Notes');
    await expect(readFile(prepared.attachments[0]!.localPath, 'utf-8')).resolves.toContain('# Notes');
  });

  it('stages outgoing artifacts from the manifest and returns warnings for invalid paths', async () => {
    const tempRoot = await createTempDir('core-stage-');
    const artifactsBaseDir = path.join(tempRoot, 'artifacts');
    const cwd = path.join(tempRoot, 'workspace');
    const generatedFile = path.join(cwd, 'reports', 'summary.md');
    vi.stubEnv('ARTIFACTS_BASE_DIR', artifactsBaseDir);

    await mkdir(path.dirname(generatedFile), { recursive: true });
    await writeFile(generatedFile, '# Summary\n', 'utf-8');

    const { stageOutgoingArtifacts } = await import('../files.js');

    const staged = await stageOutgoingArtifacts({
      conversationId: 'conv-stage',
      cwd,
      sourceMessageId: 'msg-2',
      resultText: [
        'Done.',
        '```artifacts',
        '{"files":[{"path":"reports/summary.md","title":"Summary"},{"path":"../secret.txt"}]}',
        '```',
      ].join('\n'),
    });

    expect(staged.records).toEqual([
      expect.objectContaining({
        filename: 'summary.md',
        relativePath: 'outgoing/summary.md',
        title: 'Summary',
      }),
    ]);
    expect(staged.files).toEqual([
      path.join(artifactsBaseDir, 'conv-stage', 'outgoing', 'summary.md'),
    ]);
    expect(staged.warnings).toEqual([
      expect.stringContaining('Skipped artifact `../secret.txt`'),
    ]);
  });
});
