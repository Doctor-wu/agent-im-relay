import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveRelayPaths } from '@agent-im-relay/core';

vi.mock('@clack/prompts', () => {
  let callIndex = 0;
  const responses: unknown[] = [];

  return {
    select: vi.fn(async () => responses[callIndex++]),
    text: vi.fn(async (opts: { defaultValue?: string }) => {
      const val = responses[callIndex++];
      return val === '' && opts?.defaultValue ? opts.defaultValue : val;
    }),
    group: vi.fn(async (prompts: Record<string, () => Promise<unknown>>) => {
      const result: Record<string, unknown> = {};
      for (const [key, fn] of Object.entries(prompts)) {
        result[key] = await fn();
      }
      return result;
    }),
    log: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
    isCancel: vi.fn(() => false),
    cancel: vi.fn(),
    intro: vi.fn(),
    outro: vi.fn(),
    __setResponses: (r: unknown[]) => {
      callIndex = 0;
      responses.length = 0;
      responses.push(...r);
    },
  };
});

import * as prompts from '@clack/prompts';
import { runSetup } from '../setup.js';

describe('setup flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes a discord IM record through the interactive setup flow', async () => {
    const tempHome = await mkdtemp(join('/tmp', 'agent-inbox-setup-'));
    const paths = resolveRelayPaths(tempHome);

    // Mock: select discord, then group prompts for token/clientId/guildIds
    (prompts as any).__setResponses([
      'discord',       // select platform
      'bot-token',     // token
      'client-id',     // clientId
      '',              // guildIds (empty)
    ]);

    const loaded = await runSetup(paths, ['discord', 'feishu']);

    expect(loaded.availableIms).toHaveLength(1);
    expect(loaded.availableIms[0]?.id).toBe('discord');

    const saved = await readFile(paths.configFile, 'utf-8');
    expect(saved).toContain('"id":"discord"');
  });
});
