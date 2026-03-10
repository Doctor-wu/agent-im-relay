import { afterEach, describe, expect, it } from 'vitest';
import {
  getAvailableBackendCapabilities,
  getAvailableBackendNames,
  getRegisteredBackendNames,
  isRegisteredBackendName,
  registerBackend,
  resetBackendRegistryForTests,
  type AgentBackend,
} from '../backend.js';

function createBackend(
  name: string,
  available = true,
  models: Array<{ id: string; label: string }> = [],
): AgentBackend {
  return {
    name,
    isAvailable: () => available,
    getSupportedModels: () => models,
    async *stream() {
      yield { type: 'done', result: `${name}:ok` } as const;
    },
  };
}

describe('backend registry', () => {
  afterEach(() => {
    resetBackendRegistryForTests();
  });

  it('supports dynamically registered backend names', () => {
    registerBackend(createBackend('opencode'));

    expect(getRegisteredBackendNames()).toEqual(['opencode']);
    expect(isRegisteredBackendName('opencode')).toBe(true);
    expect(isRegisteredBackendName('claude')).toBe(false);
  });

  it('lists only currently available backends', async () => {
    registerBackend(createBackend('claude'));
    registerBackend(createBackend('opencode', false));

    await expect(getAvailableBackendNames()).resolves.toEqual(['claude']);
  });

  it('returns available backend capabilities with backend-owned models', async () => {
    registerBackend(createBackend('claude', true, [
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'opus', label: 'Opus' },
    ]));
    registerBackend(createBackend('opencode', false, [
      { id: 'openai/gpt-5.2-codex', label: 'GPT-5.2 Codex' },
    ]));

    await expect(getAvailableBackendCapabilities()).resolves.toEqual([
      {
        name: 'claude',
        models: [
          { id: 'sonnet', label: 'Sonnet' },
          { id: 'opus', label: 'Opus' },
        ],
      },
    ]);
  });
});
