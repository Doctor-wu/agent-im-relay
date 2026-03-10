import { describe, expect, it, vi } from 'vitest';

const coreMocks = vi.hoisted(() => ({
  getAvailableBackendCapabilities: vi.fn(async () => [
    {
      name: 'claude',
      models: [
        { id: 'sonnet', label: 'Sonnet' },
        { id: 'opus', label: 'Opus' },
      ],
    },
    {
      name: 'opencode',
      models: [],
    },
  ]),
  conversationBackend: new Map<string, string>(),
  conversationCwd: new Map<string, string>(),
  conversationModels: new Map<string, string>(),
  persistState: vi.fn(),
}));

vi.mock('@agent-im-relay/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agent-im-relay/core')>();
  return {
    ...actual,
    getAvailableBackendCapabilities: coreMocks.getAvailableBackendCapabilities,
    conversationBackend: coreMocks.conversationBackend,
    conversationCwd: coreMocks.conversationCwd,
    conversationModels: coreMocks.conversationModels,
    persistState: coreMocks.persistState,
  };
});

import { BACKEND_SELECT_ID, applySetupResult, promptThreadSetup } from '../commands/thread-setup.js';

describe('promptThreadSetup', () => {
  it('renders backend selection and finishes with model null after selecting a backend', async () => {
    let onBackendCollect: ((interaction: any) => Promise<void>) | undefined;
    const stop = vi.fn();
    const edit = vi.fn().mockResolvedValue(undefined);
    const createMessageComponentCollector = vi.fn(() => ({
      on: vi.fn((event: string, handler: (interaction: any) => Promise<void>) => {
        if (event === 'collect') {
          onBackendCollect = handler;
        }
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
    expect(onBackendCollect).toBeTypeOf('function');

    await onBackendCollect?.({
      customId: BACKEND_SELECT_ID,
      values: ['claude'],
      deferUpdate: vi.fn().mockResolvedValue(undefined),
    });

    await expect(resultPromise).resolves.toEqual({ backend: 'claude', model: null, cwd: null });
    expect(edit).toHaveBeenCalledWith({
      content: '✅ Backend: **claude**',
      components: [],
    });
    expect(stop).toHaveBeenCalled();
    expect(createMessageComponentCollector).toHaveBeenCalledTimes(1);
  });

  it('falls back to the first available backend on timeout', async () => {
    vi.useFakeTimers();
    coreMocks.getAvailableBackendCapabilities.mockResolvedValueOnce([
      {
        name: 'opencode',
        models: [],
      },
      {
        name: 'claude',
        models: [
          { id: 'sonnet', label: 'Sonnet' },
        ],
      },
    ]);

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

    await expect(resultPromise).resolves.toEqual({ backend: 'opencode', model: null, cwd: null });
    expect(edit).toHaveBeenCalledWith({
      content: '⏰ 超时，使用默认配置。',
      components: [],
    });

    vi.useRealTimers();
  });

  it('uses default config on timeout even when the backend has models', async () => {
    vi.useFakeTimers();
    coreMocks.getAvailableBackendCapabilities.mockResolvedValueOnce([
      {
        name: 'claude',
        models: [
          { id: 'sonnet', label: 'Sonnet' },
        ],
      },
    ]);

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

    const resultPromise = promptThreadSetup(thread, 'Timeout please');
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(60_000);

    await expect(resultPromise).resolves.toEqual({ backend: 'claude', model: null, cwd: null });
    expect(edit).toHaveBeenCalledWith({
      content: '⏰ 超时，使用默认配置。',
      components: [],
    });

    vi.useRealTimers();
  });

  it('persists the selected model together with the backend', async () => {
    await applySetupResult('thread-1', {
      backend: 'claude',
      model: 'sonnet',
      cwd: null,
    });

    expect(coreMocks.conversationBackend.get('thread-1')).toBe('claude');
    expect(coreMocks.conversationModels.get('thread-1')).toBe('sonnet');
  });
});
