import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TextInteractionStrategy, type SelectionResult } from '../interaction';
import type { SelectMenuOptions } from '@agent-im-relay/core';

const flushMicrotasks = () => vi.advanceTimersByTimeAsync(0);

function makeOptions(): SelectMenuOptions & { defaultValue?: string } {
  return {
    placeholder: '请选择一个模型:',
    options: [
      { label: 'GPT-4', value: 'gpt-4' },
      { label: 'Claude', value: 'claude' },
      { label: 'Gemini', value: 'gemini' },
    ],
    defaultValue: 'claude',
  };
}

describe('TextInteractionStrategy', () => {
  let strategy: TextInteractionStrategy;
  let sendFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    sendFn = vi.fn().mockResolvedValue(undefined);
    strategy = new TextInteractionStrategy(sendFn, { selectionTimeoutMs: 10_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Idle → Waiting', () => {
    it('sends a numbered list when startSelection is called', async () => {
      const opts = makeOptions();
      const promise = strategy.startSelection('wechat:user_001', opts);

      expect(sendFn).toHaveBeenCalledOnce();
      const sentText = sendFn.mock.calls[0][1] as string;
      expect(sentText).toContain('1.');
      expect(sentText).toContain('GPT-4');
      expect(sentText).toContain('2.');
      expect(sentText).toContain('Claude');
      expect(sentText).toContain('3.');
      expect(sentText).toContain('Gemini');

      // Clean up: simulate timeout to resolve promise
      await vi.advanceTimersByTimeAsync(10_000);
      await promise;
    });

    it('is in waiting state after startSelection', async () => {
      const promise = strategy.startSelection('wechat:user_001', makeOptions());

      expect(strategy.isWaiting('wechat:user_001')).toBe(true);

      await vi.advanceTimersByTimeAsync(10_000);
      await promise;
    });
  });

  describe('Waiting + valid digit', () => {
    it('selects the option matching the digit and returns to Idle', async () => {
      const opts = makeOptions();
      const promise = strategy.startSelection('wechat:user_001', opts);

      const handled = strategy.handleInput('wechat:user_001', '2');

      expect(handled).toBe(true);

      const result = await promise;
      expect(result.value).toBe('claude');
      expect(result.label).toBe('Claude');
      expect(strategy.isWaiting('wechat:user_001')).toBe(false);
    });

    it('sends confirmation message after selection', async () => {
      const promise = strategy.startSelection('wechat:user_001', makeOptions());
      strategy.handleInput('wechat:user_001', '1');
      await promise;

      // sendFn called twice: numbered list + confirmation
      expect(sendFn).toHaveBeenCalledTimes(2);
      const confirmText = sendFn.mock.calls[1][1] as string;
      expect(confirmText).toContain('GPT-4');
    });
  });

  describe('Waiting + invalid input', () => {
    it('sends retry prompt and stays in Waiting', async () => {
      const promise = strategy.startSelection('wechat:user_001', makeOptions());

      const handled = strategy.handleInput('wechat:user_001', '9');
      expect(handled).toBe(true);
      expect(strategy.isWaiting('wechat:user_001')).toBe(true);

      // Retry prompt sent
      expect(sendFn).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(10_000);
      await promise;
    });

    it('falls back to default after 3 invalid retries', async () => {
      const opts = makeOptions();
      const promise = strategy.startSelection('wechat:user_001', opts);

      strategy.handleInput('wechat:user_001', '9');
      strategy.handleInput('wechat:user_001', '0');
      strategy.handleInput('wechat:user_001', 'x');

      const result = await promise;
      expect(result.value).toBe('claude'); // default
      expect(strategy.isWaiting('wechat:user_001')).toBe(false);
    });
  });

  describe('Waiting + timeout', () => {
    it('auto-selects default after timeout', async () => {
      const opts = makeOptions();
      const promise = strategy.startSelection('wechat:user_001', opts);

      await vi.advanceTimersByTimeAsync(10_000);

      const result = await promise;
      expect(result.value).toBe('claude');
      expect(strategy.isWaiting('wechat:user_001')).toBe(false);
    });

    it('sends timeout notice', async () => {
      strategy.startSelection('wechat:user_001', makeOptions());
      await vi.advanceTimersByTimeAsync(10_000);

      const lastCall = sendFn.mock.calls[sendFn.mock.calls.length - 1];
      const text = lastCall[1] as string;
      expect(text).toMatch(/超时|默认/);
    });
  });

  describe('message interception', () => {
    it('intercepts digit replies during Waiting state', async () => {
      const promise = strategy.startSelection('wechat:user_001', makeOptions());
      const handled = strategy.handleInput('wechat:user_001', '1');

      expect(handled).toBe(true);
      await promise;
    });

    it('does not intercept messages for non-waiting conversations', () => {
      const handled = strategy.handleInput('wechat:user_002', '1');
      expect(handled).toBe(false);
    });

    it('intercepts non-digit messages during Waiting as invalid input', async () => {
      const promise = strategy.startSelection('wechat:user_001', makeOptions());
      const handled = strategy.handleInput('wechat:user_001', 'hello');

      expect(handled).toBe(true); // intercepted
      expect(strategy.isWaiting('wechat:user_001')).toBe(true); // still waiting

      await vi.advanceTimersByTimeAsync(10_000);
      await promise;
    });
  });
});
