export interface SegmentedOutputConfig {
  charThreshold: number;
  timeThresholdMs: number;
}

type FlushCallback = (text: string) => Promise<void>;

export class SegmentedOutput {
  private buffer = '';
  private flushCallback: FlushCallback;
  private config: SegmentedOutputConfig;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;

  constructor(flushCallback: FlushCallback, config: SegmentedOutputConfig) {
    this.flushCallback = flushCallback;
    this.config = config;
  }

  append(text: string): void {
    if (this.cancelled) return;

    this.buffer += text;

    if (this.buffer.length >= this.config.charThreshold) {
      this.doFlush().catch(() => {});
    } else {
      this.resetTimer();
    }
  }

  async finish(): Promise<void> {
    if (this.cancelled) return;

    this.clearTimer();

    const content = this.buffer.length > 0
      ? `${this.buffer}\n[完成]`
      : '[完成]';

    this.buffer = '';
    await this.flushCallback(content);
  }

  cancel(): void {
    this.cancelled = true;
    this.buffer = '';
    this.clearTimer();
  }

  private async doFlush(): Promise<void> {
    if (this.buffer.length === 0) return;

    this.clearTimer();
    const content = this.buffer;
    this.buffer = '';
    await this.flushCallback(content);
  }

  private resetTimer(): void {
    this.clearTimer();

    if (this.buffer.length > 0) {
      this.timer = setTimeout(() => {
        this.doFlush().catch(() => {});
      }, this.config.timeThresholdMs);
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
