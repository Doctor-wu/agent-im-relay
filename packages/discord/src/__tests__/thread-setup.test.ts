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
  resolveBackendModelId: vi.fn((backend: string, model: string) => {
    if (backend === 'claude' && (model === 'sonnet' || model === 'opus')) {
      return model;
    }
    return undefined;
  }),
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
    resolveBackendModelId: coreMocks.resolveBackendModelId,
  };
});

import { BACKEND_SELECT_ID, MODEL_SELECT_ID, applySetupResult, promptThreadSetup } from '../commands/thread-setup.js';

describe('promptThreadSetup', () => {
  it('renders backend selection first and then model selection when the backend reports models', async () => {
    let onBackendCollect: ((interaction: any) => Promise<void>) | undefined;
    let onModelCollect: ((interaction: any) => Promise<void>) | undefined;
    const stop = vi.fn();
    const edit = vi.fn().mockResolvedValue(undefined);
    const collectors: Array<{ on: (event: string, handler: (interaction: any) => Promise<void>) => void; stop: () => void }> = [];
    const createMessageComponentCollector = vi.fn(() => {
      const collector = {
        on: vi.fn((event: string, handler: (interaction: any) => Promise<void>) => {
          if (event !== 'collect') return;
          if (!onBackendCollect) {
            onBackendCollect = handler;
            return;
          }
          onModelCollect = handler;
        }),
        stop,
      };
      collectors.push(collector);
      return collector;
    });

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
    await Promise.resolve();
    await Promise.resolve();

    expect(edit).toHaveBeenCalledWith({
      content: '**选择 Model**\nBackend: **claude**',
      components: [
        expect.objectContaining({
          toJSON: expect.any(Function),
        }),
      ],
    });
    const modelPayload = edit.mock.calls[0]?.[0];
    expect(modelPayload.components[0].toJSON().components[0].options).toEqual([
      expect.objectContaining({
        label: 'Sonnet',
        value: 'sonnet',
      }),
      expect.objectContaining({
        label: 'Opus',
        value: 'opus',
      }),
    ]);
    expect(onModelCollect).toBeTypeOf('function');

    await onModelCollect?.({
      customId: MODEL_SELECT_ID,
      values: ['opus'],
      deferUpdate: vi.fn().mockResolvedValue(undefined),
    });

    await expect(resultPromise).resolves.toEqual({ backend: 'claude', model: 'opus', cwd: null });
    expect(edit).toHaveBeenLastCalledWith({
      content: '✅ Backend: **claude**\n✅ Model: **opus**',
      components: [],
    });
    expect(stop).toHaveBeenCalled();
    expect(collectors).toHaveLength(2);
  });

  it('falls back to the first available backend on timeout when it has no models', async () => {
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

  it('does not start setup with a null model when timeout hits a backend that requires model selection', async () => {
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

    await expect(resultPromise).resolves.toBeNull();
    expect(edit).toHaveBeenCalledWith({
      content: '⏰ 超时，请重新选择 Backend 和 Model。',
      components: [],
    });

    vi.useRealTimers();
  });

  it('caps Discord model choices at 25 options', async () => {
    coreMocks.getAvailableBackendCapabilities.mockResolvedValueOnce([
      {
        name: 'claude',
        models: Array.from({ length: 30 }, (_, index) => ({
          id: `model-${index + 1}`,
          label: `Model ${index + 1}`,
        })),
      },
    ]);

    let onBackendCollect: ((interaction: any) => Promise<void>) | undefined;
    const edit = vi.fn().mockResolvedValue(undefined);
    const createMessageComponentCollector = vi.fn(() => ({
      on: vi.fn((event: string, handler: (interaction: any) => Promise<void>) => {
        if (event === 'collect') {
          onBackendCollect = handler;
        }
      }),
      stop: vi.fn(),
    }));

    const thread = {
      send: vi.fn(async () => ({
        edit,
        createMessageComponentCollector,
      })),
    } as any;

    const resultPromise = promptThreadSetup(thread, 'Limit the menu');
    await Promise.resolve();
    await Promise.resolve();

    await onBackendCollect?.({
      customId: BACKEND_SELECT_ID,
      values: ['claude'],
      deferUpdate: vi.fn().mockResolvedValue(undefined),
    });
    await Promise.resolve();
    await Promise.resolve();

    const modelPayload = edit.mock.calls[0]?.[0];
    expect(modelPayload.components[0].toJSON().components[0].options).toHaveLength(25);

    void resultPromise;
  });

  it('falls back to the first model when selection times out after choosing a backend', async () => {
    coreMocks.getAvailableBackendCapabilities.mockResolvedValueOnce([
      {
        name: 'claude',
        models: [
          { id: 'sonnet', label: 'Sonnet' },
        ],
      },
    ]);

    let onBackendCollect: ((interaction: any) => Promise<void>) | undefined;
    let onModelEnd: ((interactions: any, reason: string) => Promise<void>) | undefined;
    const edit = vi.fn().mockResolvedValue(undefined);
    let collectorIndex = 0;
    const createMessageComponentCollector = vi.fn(() => {
      const currentIndex = collectorIndex;
      collectorIndex += 1;
      return {
        on: vi.fn((event: string, handler: (interaction: any) => Promise<void>) => {
          if (currentIndex === 0 && event === 'collect') {
            onBackendCollect = handler;
            return;
          }

          if (currentIndex === 1 && event === 'end') {
            onModelEnd = handler as (interactions: any, reason: string) => Promise<void>;
          }
        }),
        stop: vi.fn(),
      };
    });

    const thread = {
      send: vi.fn(async () => ({
        edit,
        createMessageComponentCollector,
      })),
    } as any;

    const resultPromise = promptThreadSetup(thread, 'Timeout please');
    await Promise.resolve();
    await Promise.resolve();

    await onBackendCollect?.({
      customId: BACKEND_SELECT_ID,
      values: ['claude'],
      deferUpdate: vi.fn().mockResolvedValue(undefined),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(edit).toHaveBeenNthCalledWith(1, {
      content: '**选择 Model**\nBackend: **claude**',
      components: [
        expect.objectContaining({
          toJSON: expect.any(Function),
        }),
      ],
    });
    expect(createMessageComponentCollector).toHaveBeenNthCalledWith(2, expect.objectContaining({
      time: 60_000,
    }));

    await onModelEnd?.([], 'time');

    await expect(resultPromise).resolves.toEqual({
      backend: 'claude',
      model: 'sonnet',
      cwd: null,
    });
    expect(edit).toHaveBeenLastCalledWith({
      content: '⏰ Model 选择超时，使用默认 Model：**sonnet**。',
      components: [],
    });
  });

  it('opens model selection directly for preset backends and falls back on timeout', async () => {
    vi.useFakeTimers();

    let onModelCollect: ((interaction: any) => Promise<void>) | undefined;
    let onModelEnd: ((interactions: any, reason: string) => Promise<void>) | undefined;
    const edit = vi.fn().mockResolvedValue(undefined);
    const createMessageComponentCollector = vi.fn(() => ({
      on: vi.fn((event: string, handler: (interaction: any) => Promise<void>) => {
        if (event === 'collect') {
          onModelCollect = handler;
          return;
        }

        if (event === 'end') {
          onModelEnd = handler as (interactions: any, reason: string) => Promise<void>;
        }
      }),
      stop: vi.fn(),
    }));

    const thread = {
      send: vi.fn(async () => ({
        edit,
        createMessageComponentCollector,
      })),
    } as any;

    const resultPromise = promptThreadSetup(thread, 'Timeout please', {
      presetBackend: 'claude',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(thread.send).toHaveBeenCalledWith({
      content: '**选择 Model**\nBackend: **claude**',
      components: [
        expect.objectContaining({
          toJSON: expect.any(Function),
        }),
      ],
    });
    expect(onModelCollect).toBeTypeOf('function');

    await vi.advanceTimersByTimeAsync(60_000);
    await onModelEnd?.([], 'time');

    await expect(resultPromise).resolves.toEqual({
      backend: 'claude',
      model: 'sonnet',
      cwd: null,
    });
    expect(edit).toHaveBeenLastCalledWith({
      content: '⏰ Model 选择超时，使用默认 Model：**sonnet**。',
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
