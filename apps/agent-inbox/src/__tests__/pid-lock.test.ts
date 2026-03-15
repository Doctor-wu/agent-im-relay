import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquirePidLock, releasePidLock } from '../pid-lock';

const heldLocks: Array<{ dir: string; platform: string }> = [];

afterEach(async () => {
  await Promise.all(
    heldLocks.splice(0).map(({ dir, platform }) => releasePidLock(dir, platform)),
  );
});

describe('pid lock', () => {
  it('allows only one concurrent acquisition for the same platform', async () => {
    const pidsDir = await mkdtemp(join('/tmp', 'agent-inbox-pids-'));
    const platform = 'discord';

    const results = await Promise.all([
      acquirePidLock(pidsDir, platform),
      acquirePidLock(pidsDir, platform),
    ]);

    heldLocks.push({ dir: pidsDir, platform });

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter(result => !result)).toHaveLength(1);
  });
});
