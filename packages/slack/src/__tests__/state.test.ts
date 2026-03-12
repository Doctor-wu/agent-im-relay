import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(async () => {
  const { resetSlackStateForTests } = await import('../state.js');
  resetSlackStateForTests();
  vi.useRealTimers();
});

describe('Slack interactive state', () => {
  it('times out unresolved interactive waits and cleans up the stored request', async () => {
    vi.useFakeTimers();
    const {
      resolveSlackInteractiveValue,
      waitForSlackInteractiveValue,
    } = await import('../state.js');

    const pending = waitForSlackInteractiveValue('conv-timeout', 1_000);
    const rejection = expect(pending).rejects.toThrow('Slack interactive request timed out.');
    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(resolveSlackInteractiveValue('conv-timeout', 'codex')).toBe(false);
  });
});
