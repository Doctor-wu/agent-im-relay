import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readFileSyncMock } = vi.hoisted(() => ({
  readFileSyncMock: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: readFileSyncMock,
  };
});

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

describe('claude backend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFileSyncMock.mockReset();
  });

  it('lists the fixed aliases and keeps configured legacy model ids', async () => {
    readFileSyncMock
      .mockReturnValueOnce(JSON.stringify({ model: 'claude-opus-4-6' }))
      .mockReturnValueOnce(JSON.stringify({ model: 'claude-sonnet-4-5' }));

    const { claudeBackend } = await import('../../agent/backends/claude.js');

    expect(claudeBackend.listModels?.()).toEqual([
      { id: 'sonnet', label: 'sonnet' },
      { id: 'opus', label: 'opus' },
      { id: 'haiku', label: 'haiku' },
      { id: 'sonnet1m', label: 'sonnet1m' },
      { id: 'claude-opus-4-6', label: 'claude-opus-4-6' },
      { id: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
    ]);
  });
});
