import type { SelectMenuOptions } from '@agent-im-relay/core';

export interface SelectionResult {
  value: string;
  label: string;
}

export interface TextInteractionConfig {
  selectionTimeoutMs: number;
}

type SendFn = (conversationId: string, text: string) => Promise<void>;

interface WaitingState {
  conversationId: string;
  options: SelectMenuOptions & { defaultValue?: string };
  retryCount: number;
  timeoutTimer: ReturnType<typeof setTimeout>;
  resolve: (result: SelectionResult) => void;
}

const MAX_RETRIES = 3;

export class TextInteractionStrategy {
  private sendFn: SendFn;
  private config: TextInteractionConfig;
  private waiting = new Map<string, WaitingState>();

  constructor(sendFn: SendFn, config: TextInteractionConfig) {
    this.sendFn = sendFn;
    this.config = config;
  }

  isWaiting(conversationId: string): boolean {
    return this.waiting.has(conversationId);
  }

  async startSelection(
    conversationId: string,
    options: SelectMenuOptions & { defaultValue?: string },
  ): Promise<SelectionResult> {
    const result = new Promise<SelectionResult>((resolve) => {
      const timeoutTimer = setTimeout(() => {
        this.resolveWithDefault(conversationId, '超时，已自动选择默认选项');
      }, this.config.selectionTimeoutMs);

      this.waiting.set(conversationId, {
        conversationId,
        options,
        retryCount: 0,
        timeoutTimer,
        resolve,
      });
    });

    const numberedList = formatNumberedList(options);
    this.sendFn(conversationId, numberedList);

    return result;
  }

  /** Returns true if the input was intercepted (handled by interaction) */
  handleInput(conversationId: string, input: string): boolean {
    const state = this.waiting.get(conversationId);
    if (!state) return false;

    const trimmed = input.trim();
    const num = parseInt(trimmed, 10);

    if (!isNaN(num) && num >= 1 && num <= state.options.options.length) {
      const selected = state.options.options[num - 1];
      clearTimeout(state.timeoutTimer);
      this.waiting.delete(conversationId);
      this.sendFn(conversationId, `✅ 已选择: ${selected.label}`);
      state.resolve({ value: selected.value, label: selected.label });
      return true;
    }

    // Invalid input
    state.retryCount++;

    if (state.retryCount >= MAX_RETRIES) {
      this.resolveWithDefault(conversationId, '重试次数已用完，已选择默认选项');
      return true;
    }

    this.sendFn(
      conversationId,
      `请输入 1-${state.options.options.length} 的数字进行选择`,
    );
    return true;
  }

  private resolveWithDefault(conversationId: string, reason: string): void {
    const state = this.waiting.get(conversationId);
    if (!state) return;

    clearTimeout(state.timeoutTimer);
    this.waiting.delete(conversationId);

    const defaultOpt = state.options.options.find(
      (o) => o.value === state.options.defaultValue,
    ) ?? state.options.options[0];

    this.sendFn(conversationId, `${reason}: ${defaultOpt.label}`);
    state.resolve({ value: defaultOpt.value, label: defaultOpt.label });
  }
}

function formatNumberedList(options: SelectMenuOptions): string {
  const lines = [options.placeholder];
  options.options.forEach((opt, i) => {
    lines.push(`${i + 1}. ${opt.label}${opt.description ? ` - ${opt.description}` : ''}`);
  });
  return lines.join('\n');
}
