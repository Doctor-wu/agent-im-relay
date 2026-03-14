import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

async function createTempArtifactsDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'artifacts-'));
  tempDirs.push(dir);
  return dir;
}

async function setupRelayHome(
  baseDir: string,
  runtime: Record<string, unknown> = {},
): Promise<{ artifactsBaseDir: string; stateFile: string }> {
  const relayDir = path.join(baseDir, '.agent-inbox');
  vi.stubEnv('HOME', baseDir);
  vi.stubEnv('INIT_CWD', '');
  await mkdir(relayDir, { recursive: true });
  await writeFile(path.join(relayDir, 'config.jsonl'), [
    JSON.stringify({ type: 'meta', version: 1 }),
    JSON.stringify({ type: 'runtime', config: runtime }),
  ].join('\n'), 'utf-8');

  return {
    artifactsBaseDir: path.join(relayDir, 'artifacts'),
    stateFile: path.join(relayDir, 'state', 'sessions.json'),
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await rm(dir, { recursive: true, force: true });
  }));
});

describe('artifact store', () => {
  it('allocates per-conversation directories under the artifact root', async () => {
    const tempRootDir = await createTempArtifactsDir();
    const { artifactsBaseDir } = await setupRelayHome(tempRootDir);

    const { ensureConversationArtifactPaths } = await import('../artifacts/store.js');

    const paths = await ensureConversationArtifactPaths('conv-123');

    expect(paths.rootDir).toBe(path.join(artifactsBaseDir, 'conv-123'));
    expect(paths.incomingDir).toBe(path.join(artifactsBaseDir, 'conv-123', 'incoming'));
    expect(paths.outgoingDir).toBe(path.join(artifactsBaseDir, 'conv-123', 'outgoing'));
    expect(paths.metaFile).toBe(path.join(artifactsBaseDir, 'conv-123', 'meta.json'));
  });

  it('writes and reloads lightweight metadata from meta.json', async () => {
    const tempRootDir = await createTempArtifactsDir();
    const { artifactsBaseDir } = await setupRelayHome(tempRootDir);

    const { ensureConversationArtifactPaths, readArtifactMetadata, writeArtifactMetadata } = await import('../artifacts/store.js');

    const paths = await ensureConversationArtifactPaths('conv-meta');
    const metadata = {
      incoming: [
        {
          id: 'incoming-1',
          filename: 'spec.md',
          relativePath: 'incoming/spec.md',
          mimeType: 'text/markdown',
          size: 12,
          kind: 'markdown',
          createdAt: '2026-03-07T00:00:00.000Z',
          sourceMessageId: 'msg-1',
        },
      ],
      outgoing: [],
      lastUpdatedAt: '2026-03-07T00:00:01.000Z',
    };

    await writeArtifactMetadata(paths, metadata);

    await expect(readArtifactMetadata(paths)).resolves.toEqual(metadata);
    await expect(readFile(paths.metaFile, 'utf-8')).resolves.toContain('"filename": "spec.md"');
  });

  it('persists artifact metadata separately from session state', async () => {
    const tempRootDir = await createTempArtifactsDir();
    const { artifactsBaseDir, stateFile } = await setupRelayHome(tempRootDir);

    const metadata = {
      incoming: [
        {
          id: 'incoming-1',
          filename: 'spec.md',
          relativePath: 'incoming/spec.md',
          mimeType: 'text/markdown',
          size: 12,
          kind: 'markdown',
          createdAt: '2026-03-07T00:00:00.000Z',
          sourceMessageId: 'msg-1',
        },
      ],
      outgoing: [],
      lastUpdatedAt: '2026-03-07T00:00:01.000Z',
    };

    const state = await import('../state.js');
    state.conversationSessions.set('conv-meta', 'session-1');

    await state.persistConversationArtifactMetadata('conv-meta', metadata);
    await state.persistState();

    const persistedState = JSON.parse(await readFile(stateFile, 'utf-8')) as Record<string, unknown>;
    expect(persistedState).toEqual({
      sessions: { 'conv-meta': 'session-1' },
      models: {},
      effort: {},
      cwd: {},
      backend: {},
      threadSessionBindings: {},
      threadContinuationSnapshots: {},
      savedCwdList: [],
    });
    expect(JSON.stringify(persistedState)).not.toContain('spec.md');

    state.conversationArtifacts.clear();

    await expect(state.getConversationArtifactMetadata('conv-meta')).resolves.toEqual(metadata);
  });

  it('removes expired artifact directories during lazy cleanup', async () => {
    const tempRootDir = await createTempArtifactsDir();
    const { artifactsBaseDir } = await setupRelayHome(tempRootDir, {
      artifactRetentionDays: 1,
    });

    const expiredDir = path.join(artifactsBaseDir, 'expired-conversation');
    await mkdir(expiredDir, { recursive: true });

    const expiredAt = new Date(Date.now() - (3 * 24 * 60 * 60 * 1000));
    await utimes(expiredDir, expiredAt, expiredAt);

    const { ensureConversationArtifactPaths } = await import('../artifacts/store.js');
    await ensureConversationArtifactPaths('fresh-conversation');

    await expect(access(expiredDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('artifact protocol', () => {
  it('parses the last valid artifacts fenced block', async () => {
    const { parseArtifactManifest } = await import('../artifacts/protocol.js');

    const text = [
      'ignore this block',
      '```artifacts',
      '{ "files": [',
      '  { "path": "draft.txt" }',
      '] }',
      '```',
      '',
      'broken block',
      '```artifacts',
      '{ "files": [',
      '  { "path": ',
      '```',
      '',
      'keep this one',
      '```artifacts',
      '{',
      '  "files": [',
      '    { "path": "reports/summary.md", "title": "Summary" },',
      '    { "path": "images/preview.png" }',
      '  ]',
      '}',
      '```',
    ].join('\n');

    expect(parseArtifactManifest(text)).toEqual({
      files: [
        { path: 'reports/summary.md', title: 'Summary' },
        { path: 'images/preview.png' },
      ],
    });
  });

  it('rejects paths that escape the allowed root', async () => {
    const { resolveArtifactPath } = await import('../artifacts/protocol.js');

    const rootDir = path.join('/tmp', 'artifact-root');

    expect(() => resolveArtifactPath(rootDir, 'reports/summary.md')).not.toThrow();
    expect(() => resolveArtifactPath(rootDir, '../secrets.txt')).toThrow(/allowed root/i);
    expect(() => resolveArtifactPath(rootDir, '/etc/passwd')).toThrow(/allowed root/i);
  });

  it('removes artifacts fenced blocks from rendered output', async () => {
    const { stripArtifactManifest } = await import('../artifacts/protocol.js');

    const text = [
      'Here is your summary.',
      '',
      '```artifacts',
      '{ "files": [{ "path": "reports/summary.md" }] }',
      '```',
      '',
      'Thanks.',
    ].join('\n');

    expect(stripArtifactManifest(text)).toBe(['Here is your summary.', '', 'Thanks.'].join('\n'));
  });
});

describe('artifact state integration', () => {
  it('reloads persisted sessions when artifact directories or metadata files are missing', async () => {
    const tempRootDir = await createTempArtifactsDir();
    const { artifactsBaseDir, stateFile } = await setupRelayHome(tempRootDir);

    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(stateFile, JSON.stringify({
      sessions: { 'conv-missing': 'session-1' },
      models: {},
      effort: {},
      cwd: {},
      backend: {},
      savedCwdList: [],
    }, null, 2), 'utf-8');

    const state = await import('../state.js');

    await expect(state.initState()).resolves.toBeUndefined();
    await expect(state.getConversationArtifactMetadata('conv-missing')).resolves.toEqual({
      incoming: [],
      outgoing: [],
      lastUpdatedAt: null,
    });
    await expect(access(path.join(artifactsBaseDir, 'conv-missing'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
