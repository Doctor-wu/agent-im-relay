import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SegmentedOutput } from '../streaming';

describe('SegmentedOutput', () => {
  let flushCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    flushCallback = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('buffers text chunks without immediate flush', () => {
    const output = new SegmentedOutput(flushCallback, { charThreshold: 500, timeThresholdMs: 3_000 });
    output.append('Hello');
    output.append(' world');

    expect(flushCallback).not.toHaveBeenCalled();
  });

  it('flushes when buffer reaches character threshold', async () => {
    const output = new SegmentedOutput(flushCallback, { charThreshold: 10, timeThresholdMs: 3_000 });
    output.append('12345');
    output.append('67890X');

    await vi.advanceTimersByTimeAsync(0);

    expect(flushCallback).toHaveBeenCalledOnce();
    expect(flushCallback.mock.calls[0][0]).toBe('1234567890X');
  });

  it('flushes when time threshold elapses', async () => {
    const output = new SegmentedOutput(flushCallback, { charThreshold: 500, timeThresholdMs: 3_000 });
    output.append('Hello');

    await vi.advanceTimersByTimeAsync(3_000);

    expect(flushCallback).toHaveBeenCalledOnce();
    expect(flushCallback.mock.calls[0][0]).toBe('Hello');
  });

  it('appends [完成] suffix on finish()', async () => {
    const output = new SegmentedOutput(flushCallback, { charThreshold: 500, timeThresholdMs: 3_000 });
    output.append('Result');

    await output.finish();

    expect(flushCallback).toHaveBeenCalledOnce();
    expect(flushCallback.mock.calls[0][0]).toBe('Result\n[完成]');
  });

  it('produces multiple flushes in order', async () => {
    const output = new SegmentedOutput(flushCallback, { charThreshold: 10, timeThresholdMs: 3_000 });

    output.append('AAAAAAAAA'); // 9 chars, under threshold
    output.append('BB'); // 11 chars total, triggers flush
    await vi.advanceTimersByTimeAsync(0);

    output.append('CCCCCCCCC'); // 9 chars
    output.append('DD'); // 11 chars, triggers flush again
    await vi.advanceTimersByTimeAsync(0);

    expect(flushCallback).toHaveBeenCalledTimes(2);
    expect(flushCallback.mock.calls[0][0]).toBe('AAAAAAAAABB');
    expect(flushCallback.mock.calls[1][0]).toBe('CCCCCCCCCDD');
  });

  it('does not flush empty buffer on time threshold', async () => {
    const output = new SegmentedOutput(flushCallback, { charThreshold: 500, timeThresholdMs: 3_000 });

    await vi.advanceTimersByTimeAsync(3_000);

    expect(flushCallback).not.toHaveBeenCalled();
  });

  it('does not flush empty buffer on finish()', async () => {
    const output = new SegmentedOutput(flushCallback, { charThreshold: 500, timeThresholdMs: 3_000 });

    await output.finish();

    // Only [完成] marker, no content before it
    expect(flushCallback).toHaveBeenCalledOnce();
    expect(flushCallback.mock.calls[0][0]).toBe('[完成]');
  });

  it('cancel() clears buffer and timers', async () => {
    const output = new SegmentedOutput(flushCallback, { charThreshold: 500, timeThresholdMs: 3_000 });
    output.append('Some text');
    output.cancel();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(flushCallback).not.toHaveBeenCalled();
  });

  it('resets time threshold timer after each flush', async () => {
    const output = new SegmentedOutput(flushCallback, { charThreshold: 500, timeThresholdMs: 3_000 });
    output.append('First');

    await vi.advanceTimersByTimeAsync(3_000);
    expect(flushCallback).toHaveBeenCalledTimes(1);

    output.append('Second');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(flushCallback).toHaveBeenCalledTimes(2);
    expect(flushCallback.mock.calls[1][0]).toBe('Second');
  });
});
