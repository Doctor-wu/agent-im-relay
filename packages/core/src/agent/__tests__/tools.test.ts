import { describe, expect, it } from 'vitest';
import { toolsForMode } from '../tools';

describe('toolsForMode', () => {
  it('returns code mode arguments', () => {
    expect(toolsForMode('code')).toEqual(['--dangerously-skip-permissions']);
  });

  it('returns ask mode arguments (no tool flags)', () => {
    expect(toolsForMode('ask')).toEqual([]);
  });

  it('returns new arrays per call', () => {
    const first = toolsForMode('code');
    const second = toolsForMode('code');
    expect(first).not.toBe(second);
  });
});
