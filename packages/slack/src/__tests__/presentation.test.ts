import { describe, expect, it, vi } from 'vitest';

describe('Slack reactions', () => {
  it('switches reactions as the conversation phase changes', async () => {
    const { applySlackReaction } = await import('../presentation.js');
    const transport = {
      addReaction: vi.fn(async () => undefined),
      removeReaction: vi.fn(async () => undefined),
    };

    await applySlackReaction(transport, {
      channelId: 'C123',
      messageTs: '1741766600.000001',
    }, 'thinking', 'received');

    expect(transport.removeReaction).toHaveBeenCalledTimes(1);
    expect(transport.addReaction).toHaveBeenCalledTimes(1);
  });

  it('ignores Slack reaction API failures', async () => {
    const { applySlackReaction } = await import('../presentation.js');
    const transport = {
      addReaction: vi.fn(async () => {
        throw new Error('denied');
      }),
      removeReaction: vi.fn(async () => undefined),
    };

    await expect(applySlackReaction(transport, {
      channelId: 'C123',
      messageTs: '1741766600.000001',
    }, 'done', 'thinking')).resolves.toBeUndefined();
  });
});
