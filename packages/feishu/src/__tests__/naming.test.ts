import { describe, expect, it } from 'vitest';
import { buildFeishuSessionChatName } from '../index.js';

describe('Feishu session naming', () => {
  it('builds a readable session chat name from the original prompt', () => {
    expect(buildFeishuSessionChatName('  重构\n Feishu   面板交互  ')).toBe(
      'Session · 重构 Feishu 面板交互',
    );
  });

  it('truncates very long prompts to keep the chat title compact', () => {
    expect(buildFeishuSessionChatName('a'.repeat(80))).toBe(
      `Session · ${'a'.repeat(48)}`,
    );
  });
});
