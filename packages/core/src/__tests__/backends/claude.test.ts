import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

describe('claude backend', () => {
  it('lists the fixed Claude model aliases', async () => {
    const { claudeBackend } = await import('../../agent/backends/claude.js');

    expect(claudeBackend.listModels?.()).toEqual([
      { id: 'sonnet', label: 'sonnet' },
      { id: 'opus', label: 'opus' },
      { id: 'haiku', label: 'haiku' },
      { id: 'sonnet1m', label: 'sonnet1m' },
    ]);
  });
});
