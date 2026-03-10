import { describe, expect, it, vi } from 'vitest';

const coreMocks = vi.hoisted(() => ({
  getAvailableBackendNames: vi.fn(async () => ['claude', 'opencode']),
}));

vi.mock('@agent-im-relay/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agent-im-relay/core')>();
  return {
    ...actual,
    getAvailableBackendNames: coreMocks.getAvailableBackendNames,
  };
});

import { BACKEND_SELECT_ID, promptThreadSetup } from '../commands/thread-setup.js';

describe('promptThreadSetup', () => {
  it('renders only backend selection and resolves on select', async () => {
    let onCollect: ((interaction: any) => Promise<void>) | undefined;
    const stop = vi.fn();
    const edit = vi.fn().mockResolvedValue(undefined);
    const createMessageComponentCollector = vi.fn(() => ({
      on: vi.fn((event: string, handler: (interaction: any) => Promise<void>) => {
        if (event === 'collect') onCollect = handler;
      }),
      stop,
    }));

    let payload: any;
    const thread = {
      send: vi.fn(async (value: any) => {
        payload = value;
        return {
          edit,
          createMessageComponentCollector,
        };
      }),
    } as any;

    const resultPromise = promptThreadSetup(thread, 'Fix the awkward setup flow');
    await Promise.resolve();
    await Promise.resolve();

    expect(payload.content).toContain('选择 AI Backend');
    expect(payload.components).toHaveLength(1);
    expect(payload.components[0].toJSON().components).toHaveLength(1);
    expect(payload.components[0].toJSON().components[0].options).toEqual([
      expect.objectContaining({
        label: 'Claude (Claude Code)',
        value: 'claude',
      }),
      expect.objectContaining({
        label: 'OpenCode',
        value: 'opencode',
      }),
    ]);
    expect(onCollect).toBeTypeOf('function');

    await onCollect?.({
      customId: BACKEND_SELECT_ID,
      values: ['opencode'],
      deferUpdate: vi.fn().mockResolvedValue(undefined),
    });

    await expect(resultPromise).resolves.toEqual({ backend: 'opencode', cwd: null });
    expect(edit).toHaveBeenCalledWith({
      content: '✅ Backend: **opencode**',
      components: [],
    });
    expect(stop).toHaveBeenCalled();
  });

  it('falls back to the first available backend on timeout', async () => {
    vi.useFakeTimers();
    coreMocks.getAvailableBackendNames.mockResolvedValueOnce(['opencode', 'claude']);

    const edit = vi.fn().mockResolvedValue(undefined);
    const createMessageComponentCollector = vi.fn(() => ({
      on: vi.fn(),
      stop: vi.fn(),
    }));

    const thread = {
      send: vi.fn(async () => ({
        edit,
        createMessageComponentCollector,
      })),
    } as any;

    const resultPromise = promptThreadSetup(thread, 'Fallback please');
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(60_000);

    await expect(resultPromise).resolves.toEqual({ backend: 'opencode', cwd: null });
    expect(edit).toHaveBeenCalledWith({
      content: '⏰ 超时，使用默认配置。',
      components: [],
    });

    vi.useRealTimers();
  });
});
