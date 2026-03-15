import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(testDir, '..', '..');

describe('npm packaging contract', () => {
  it(
    'publishes a tarball that installs and imports in a clean npm consumer project',
    () => {
      const packDir = mkdtempSync(join(tmpdir(), 'discord-pack-'));
      const installDir = mkdtempSync(join(tmpdir(), 'discord-install-'));
      const npmCacheDir = mkdtempSync(join(tmpdir(), 'discord-npm-cache-'));
      const homeDir = mkdtempSync(join(tmpdir(), 'discord-home-'));

      const relayHomeDir = join(homeDir, '.agent-inbox');
      mkdirSync(relayHomeDir, { recursive: true });
      writeFileSync(
        join(relayHomeDir, 'config.jsonl'),
        `${JSON.stringify({
          type: 'im',
          id: 'discord',
          enabled: true,
          config: {
            token: 'test-token',
            clientId: 'test-client-id',
          },
        })}\n`,
        'utf-8',
      );

      const packResult = spawnSync(
        'pnpm',
        ['pack', '--pack-destination', packDir],
        {
          cwd: packageDir,
          encoding: 'utf-8',
        },
      );

      expect(packResult.status).toBe(0);

      const tarball = readdirSync(packDir).find(entry => entry.endsWith('.tgz'));
      expect(tarball).toBeDefined();

      const env = {
        ...process.env,
        HOME: homeDir,
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

      const importResult = spawnSync(
        'node',
        ['--input-type=module', '--eval', "await import('@agent-im-relay/discord')"],
        {
          cwd: installDir,
          encoding: 'utf-8',
          env,
        },
      );

      expect(importResult.status).toBe(0);
    },
    120_000,
  );
});
