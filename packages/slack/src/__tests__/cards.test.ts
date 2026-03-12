import { describe, expect, it } from 'vitest';

describe('Slack Block Kit cards', () => {
  it('builds a backend selection card with one action per backend', async () => {
    const { buildSlackBackendSelectionBlocks } = await import('../cards.js');

    const blocks = buildSlackBackendSelectionBlocks({
      conversationId: '1741766400.123456',
      prompt: 'ship it',
      backends: ['claude', 'codex'],
    });

    expect(blocks[0]).toMatchObject({
      type: 'section',
      text: {
        type: 'mrkdwn',
      },
    });
    expect(blocks[1]).toMatchObject({
      type: 'actions',
    });
    expect(blocks[1]?.elements).toHaveLength(2);
  });

  it('builds a model selection card that exposes model ids in action values', async () => {
    const { buildSlackModelSelectionBlocks } = await import('../cards.js');

    const blocks = buildSlackModelSelectionBlocks({
      conversationId: '1741766400.123456',
      backend: 'codex',
      models: [
        { id: 'gpt-4.1', label: 'GPT-4.1' },
        { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
      ],
    });

    expect(blocks[1]).toMatchObject({
      type: 'actions',
    });
    expect(blocks[1]?.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'button',
        text: expect.objectContaining({ text: 'GPT-4.1' }),
        value: expect.stringContaining('"value":"gpt-4.1"'),
      }),
    ]));
  });
});
