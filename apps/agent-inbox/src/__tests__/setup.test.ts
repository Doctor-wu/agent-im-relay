import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { resolveRelayPaths } from '@agent-im-relay/core';
import { runSetup } from '../setup.js';

describe('setup flow', () => {
  it('writes a discord IM record through the interactive setup flow', async () => {
    const tempHome = await mkdtemp(join('/tmp', 'agent-inbox-setup-'));
    const output = new PassThrough();

    const paths = resolveRelayPaths(tempHome);
    const loaded = await runSetup(paths, {
      output,
      answers: ['1', 'bot-token', 'client-id', ''],
    });

    expect(loaded.availableIms).toHaveLength(1);
    expect(loaded.availableIms[0]?.id).toBe('discord');

    const saved = await readFile(paths.configFile, 'utf-8');
    expect(saved).toContain('"id":"discord"');
  });
});
