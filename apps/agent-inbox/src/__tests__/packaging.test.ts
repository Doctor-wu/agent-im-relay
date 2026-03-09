import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const appDir = join(testDir, '..', '..');
const repoRoot = join(appDir, '..', '..');

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf-8')) as T;
}

describe('npm packaging contract', () => {
  it('keeps the workspace root package distinct from the app package', async () => {
    const rootPackage = await readJsonFile<{ name: string; scripts?: Record<string, string> }>(
      join(repoRoot, 'package.json'),
    );
    const appPackage = await readJsonFile<{
      name: string;
      scripts?: Record<string, string>;
      bin?: Record<string, string>;
      files?: string[];
      dependencies?: Record<string, string>;
      engines?: Record<string, string>;
    }>(join(appDir, 'package.json'));

    expect(rootPackage.name).not.toBe(appPackage.name);
    expect(appPackage.name).toBe('@doctorwu/agent-inbox');
    expect(rootPackage.scripts?.['start']).toBe('pnpm --filter ./apps/agent-inbox start');
    expect(appPackage.bin).toEqual({ 'agent-inbox': 'dist/index.mjs' });
    expect(appPackage.engines?.['node']).toBe('>=20');
    expect(appPackage.files).toContain('dist');
    expect(appPackage.dependencies).not.toHaveProperty('@agent-im-relay/core');
    expect(appPackage.dependencies).not.toHaveProperty('@agent-im-relay/discord');
    expect(appPackage.dependencies).not.toHaveProperty('@agent-im-relay/feishu');
    expect(appPackage.scripts?.['prepack']).toBe('pnpm run build');
  });

  it(
    'publishes a tarball that installs in a clean npm consumer project',
    () => {
      const packDir = mkdtempSync(join(tmpdir(), 'agent-inbox-pack-'));
      const installDir = mkdtempSync(join(tmpdir(), 'agent-inbox-install-'));
      const npmCacheDir = mkdtempSync(join(tmpdir(), 'agent-inbox-npm-cache-'));

      const packResult = spawnSync(
        'pnpm',
        ['pack', '--pack-destination', packDir],
        {
          cwd: appDir,
          encoding: 'utf-8',
        },
      );

      expect(packResult.status).toBe(0);

      const tarball = readdirSync(packDir).find(entry => entry.endsWith('.tgz'));
      expect(tarball).toBeDefined();

      const env = {
        ...process.env,
        NPM_CONFIG_CACHE: npmCacheDir,
      };

      const initResult = spawnSync('npm', ['init', '-y'], {
        cwd: installDir,
        encoding: 'utf-8',
        env,
      });
      expect(initResult.status).toBe(0);

      const installResult = spawnSync('npm', ['install', join(packDir, tarball!)], {
        cwd: installDir,
        encoding: 'utf-8',
        env,
      });

      expect(installResult.status).toBe(0);
    },
    120_000,
  );
});
