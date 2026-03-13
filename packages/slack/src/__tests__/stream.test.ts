import { describe, expect, it, vi } from 'vitest';

describe('streamSlackMessages', () => {
  it('streams agent output by updating one Slack message in place', async () => {
    const { streamSlackMessages } = await import('../stream.js');
    const transport = {
      sendMessage: vi.fn(async () => ({ ts: '1741766700.000001' })),
      updateMessage: vi.fn(async () => undefined),
    };

    async function* events() {
      yield { type: 'status' as const, status: 'thinking' };
      yield { type: 'text' as const, delta: 'Hello' };
      yield { type: 'tool' as const, summary: 'running Bash {"command":"pnpm test"}' };
      yield { type: 'done' as const, result: 'Hello' };
    }

    await streamSlackMessages({
      transport,
      target: {
        channelId: 'C123',
        threadTs: '1741766400.123456',
      },
      updateIntervalMs: 0,
    }, events());

    expect(transport.sendMessage).toHaveBeenCalledTimes(1);
    expect(transport.updateMessage).toHaveBeenCalled();
  });

  it('falls back to posting a new Slack message when updates fail', async () => {
    const { streamSlackMessages } = await import('../stream.js');
    const transport = {
      sendMessage: vi.fn(async () => ({ ts: '1741766700.000001' })),
      updateMessage: vi.fn(async () => {
        throw new Error('rate limited');
      }),
    };

    async function* events() {
      yield { type: 'text' as const, delta: 'Hello' };
      yield { type: 'done' as const, result: 'Hello again' };
    }

    await streamSlackMessages({
      transport,
      target: {
        channelId: 'C123',
        threadTs: '1741766400.123456',
      },
      updateIntervalMs: 0,
    }, events());

    expect(transport.sendMessage).toHaveBeenCalledTimes(2);
  });
});
