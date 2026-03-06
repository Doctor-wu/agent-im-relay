import { describe, expect, it } from 'vitest';
import { toolsForMode } from '../tools.js';

describe('toolsForMode', () => {
  it('returns code mode arguments', () => {
    expect(toolsForMode('code')).toEqual(['--dangerously-skip-permissions']);
  });

  it('returns ask mode arguments', () => {
    expect(toolsForMode('ask')).toEqual(['--allowedTools', '']);
  });

  it('returns new arrays per call', () => {
    const first = toolsForMode('code');
    const second = toolsForMode('code');
    expect(first).not.toBe(second);
  });
});
