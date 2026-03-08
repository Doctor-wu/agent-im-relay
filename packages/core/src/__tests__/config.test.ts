import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('core config', () => {
  it('reflects environment overrides even after the module is imported', async () => {
    const { config } = await import('../config.js');

    vi.stubEnv('STATE_FILE', '/tmp/agent-inbox-state-a.json');
    expect(config.stateFile).toBe('/tmp/agent-inbox-state-a.json');

    vi.stubEnv('STATE_FILE', '/tmp/agent-inbox-state-b.json');
    expect(config.stateFile).toBe('/tmp/agent-inbox-state-b.json');
  });
});
