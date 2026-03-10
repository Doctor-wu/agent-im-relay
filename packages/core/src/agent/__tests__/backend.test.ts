import { afterEach, describe, expect, it } from 'vitest';
import {
  getAvailableBackendNames,
  getRegisteredBackendNames,
  isRegisteredBackendName,
  registerBackend,
  resetBackendRegistryForTests,
  type AgentBackend,
} from '../backend.js';

function createBackend(name: string, available = true): AgentBackend {
  return {
    name,
    isAvailable: () => available,
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
});
