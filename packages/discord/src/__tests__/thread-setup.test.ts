import { describe, expect, it, vi } from 'vitest';
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

    expect(payload.content).toContain('选择 AI Backend');
    expect(payload.components).toHaveLength(1);
    expect(payload.components[0].toJSON().components).toHaveLength(1);

    await onCollect?.({
      customId: BACKEND_SELECT_ID,
      values: ['codex'],
      deferUpdate: vi.fn().mockResolvedValue(undefined),
    });

    await expect(resultPromise).resolves.toEqual({ backend: 'codex', cwd: null });
    expect(edit).toHaveBeenCalledWith({
      content: '✅ Backend: **codex**',
      components: [],
    });
    expect(stop).toHaveBeenCalled();
  });
});
