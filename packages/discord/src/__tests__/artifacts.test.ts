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

describe('publishConversationArtifacts', () => {
  it('uploads valid artifact files and records outgoing metadata', async () => {
    const tempRoot = await createTempDir();
    const cwd = path.join(tempRoot, 'workspace');
    const artifactsBaseDir = await setupDiscordRelayHome(tempRoot);
    const generatedFile = path.join(cwd, 'reports', 'summary.md');

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

  it('mentions the triggering bot on artifact uploads', async () => {
    const tempRoot = await createTempDir();
    const cwd = path.join(tempRoot, 'workspace');
    const artifactsBaseDir = await setupDiscordRelayHome(tempRoot);
    const generatedFile = path.join(cwd, 'reports', 'summary.md');

    await mkdir(path.dirname(generatedFile), { recursive: true });
    await writeFile(generatedFile, '# Summary\n', 'utf-8');

    const { publishConversationArtifacts } = await import('../artifacts.js');
    const send = vi.fn().mockResolvedValue({});

    await publishConversationArtifacts({
      conversationId: 'thread-bot-upload',
      cwd,
      resultText: [
        'Done.',
        '```artifacts',
        '{ "files": [{ "path": "reports/summary.md" }] }',
        '```',
      ].join('\n'),
      channel: { send },
      replyContext: { mentionUserId: 'other-bot' },
    });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      content: '<@other-bot> 📎 Returned 1 file.',
      allowedMentions: { users: ['other-bot'] },
      files: [path.join(artifactsBaseDir, 'thread-bot-upload', 'outgoing', 'summary.md')],
    }));
  });

  it('ignores invalid artifact paths and reports a warning', async () => {
    const tempRoot = await createTempDir();
    const cwd = path.join(tempRoot, 'workspace');
    await setupDiscordRelayHome(tempRoot);

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

  it('mentions warning follow-ups for bot-triggered runs', async () => {
    const tempRoot = await createTempDir();
    const cwd = path.join(tempRoot, 'workspace');
    await setupDiscordRelayHome(tempRoot);

    await mkdir(cwd, { recursive: true });

    const { publishConversationArtifacts } = await import('../artifacts.js');
    const send = vi.fn().mockResolvedValue({});

    await publishConversationArtifacts({
      conversationId: 'thread-bot-warning',
      cwd,
      resultText: [
        'Done.',
        '```artifacts',
        '{ "files": [{ "path": "../secret.txt" }] }',
        '```',
      ].join('\n'),
      channel: { send },
      replyContext: { mentionUserId: 'other-bot' },
    });

    expect(send).toHaveBeenCalledWith({
      content: '<@other-bot> ⚠️ Skipped artifact `../secret.txt`: path must stay within the allowed root.',
      allowedMentions: { users: ['other-bot'] },
    });
  });

  it('reports upload failures without dropping the saved artifact copy', async () => {
    const tempRoot = await createTempDir();
    const cwd = path.join(tempRoot, 'workspace');
    await setupDiscordRelayHome(tempRoot);
    const generatedFile = path.join(cwd, 'reports', 'summary.md');

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
    await setupDiscordRelayHome(tempRoot, {
      artifactMaxSizeBytes: 4,
    });
    const generatedFile = path.join(cwd, 'reports', 'summary.md');

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
