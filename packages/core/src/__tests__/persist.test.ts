import { afterEach, describe, expect, it, vi } from 'vitest';
import { glob, mkdir } from 'node:fs/promises';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadState } from '../persist.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('persist state loading', () => {
  it('quarantines malformed state files instead of retrying to parse them forever', async () => {
    const tempDir = await mkdtemp('/tmp/agent-inbox-persist-');
    const stateFile = join(tempDir, 'state', 'sessions.json');
    vi.stubEnv('STATE_FILE', stateFile);
    await mkdir(join(tempDir, 'state'), { recursive: true });
    await writeFile(stateFile, '{"sessions":{}}\n}broken', 'utf-8');

    const sessions = new Map<string, string>();
    const models = new Map<string, string>();
    const effort = new Map<string, string>();
    const cwd = new Map<string, string>();
    const backend = new Map<string, string>();
    const bindings = new Map();
    const snapshots = new Map();
    const savedCwdList: string[] = [];

    await loadState(
      sessions,
      models,
      effort,
      cwd,
      backend,
      bindings,
      snapshots,
      savedCwdList,
    );

    expect(sessions.size).toBe(0);
    const backups = await Array.fromAsync(glob(`${stateFile}.broken-*`));
    expect(backups.length).toBe(1);
    await expect(readFile(backups[0]!, 'utf-8')).resolves.toContain('}broken');
  });
});
