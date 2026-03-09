import { readFile } from 'node:fs/promises';
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
      engines?: Record<string, string>;
    }>(join(appDir, 'package.json'));

    expect(rootPackage.name).not.toBe(appPackage.name);
    expect(appPackage.name).toBe('@doctorwu/agent-inbox');
    expect(rootPackage.scripts?.['start']).toBe('pnpm --filter ./apps/agent-inbox start');
    expect(appPackage.bin).toEqual({ 'agent-inbox': 'dist/index.mjs' });
    expect(appPackage.engines?.['node']).toBe('>=20');
    expect(appPackage.files).toContain('dist');
    expect(appPackage.scripts?.['prepack']).toBe('pnpm run build');
  });
});
