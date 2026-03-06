import { describe, expect, it } from 'vitest';
import { sanitizeThreadName } from '../thread.js';

describe('sanitizeThreadName', () => {
  it('normalizes whitespace and prefixes thread names', () => {
    const name = sanitizeThreadName('   Fix    flaky   tests   ');
    expect(name).toBe('code: Fix flaky tests');
  });

  it('falls back to a default title when prompt is empty', () => {
    expect(sanitizeThreadName('   ')).toBe('code: New coding task');
  });

  it('truncates long prompts to Discord limits', () => {
    const name = sanitizeThreadName('x'.repeat(500));
    expect(name.startsWith('code: ')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(100);
  });
});
