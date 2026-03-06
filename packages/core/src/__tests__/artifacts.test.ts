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

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await rm(dir, { recursive: true, force: true });
  }));
});

describe('artifact store', () => {
  it('allocates per-conversation directories under the artifact root', async () => {
    const artifactBaseDir = await createTempArtifactsDir();
    vi.stubEnv('ARTIFACTS_BASE_DIR', artifactBaseDir);

    const { ensureConversationArtifactPaths } = await import('../artifacts/store.js');

    const paths = await ensureConversationArtifactPaths('conv-123');

    expect(paths.rootDir).toBe(path.join(artifactBaseDir, 'conv-123'));
    expect(paths.incomingDir).toBe(path.join(artifactBaseDir, 'conv-123', 'incoming'));
    expect(paths.outgoingDir).toBe(path.join(artifactBaseDir, 'conv-123', 'outgoing'));
    expect(paths.metaFile).toBe(path.join(artifactBaseDir, 'conv-123', 'meta.json'));
  });

  it('writes and reloads lightweight metadata from meta.json', async () => {
    const artifactBaseDir = await createTempArtifactsDir();
    vi.stubEnv('ARTIFACTS_BASE_DIR', artifactBaseDir);

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
    const artifactBaseDir = path.join(tempRootDir, 'artifacts');
    const stateFile = path.join(tempRootDir, 'state', 'sessions.json');
    vi.stubEnv('ARTIFACTS_BASE_DIR', artifactBaseDir);
    vi.stubEnv('STATE_FILE', stateFile);

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
      savedCwdList: [],
    });
    expect(JSON.stringify(persistedState)).not.toContain('spec.md');

    state.conversationArtifacts.clear();

    await expect(state.getConversationArtifactMetadata('conv-meta')).resolves.toEqual(metadata);
  });

  it('removes expired artifact directories during lazy cleanup', async () => {
    const artifactBaseDir = await createTempArtifactsDir();
    vi.stubEnv('ARTIFACTS_BASE_DIR', artifactBaseDir);
    vi.stubEnv('ARTIFACT_RETENTION_DAYS', '1');

    const expiredDir = path.join(artifactBaseDir, 'expired-conversation');
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
    const artifactBaseDir = path.join(tempRootDir, 'artifacts');
    const stateFile = path.join(tempRootDir, 'state', 'sessions.json');
    vi.stubEnv('ARTIFACTS_BASE_DIR', artifactBaseDir);
    vi.stubEnv('STATE_FILE', stateFile);

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
    await expect(access(path.join(artifactBaseDir, 'conv-missing'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
