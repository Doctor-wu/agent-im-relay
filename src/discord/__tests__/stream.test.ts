import { describe, expect, it } from 'vitest';
import { chunkForDiscord, formatToolLine, getToolIcon } from '../stream.js';

describe('chunkForDiscord', () => {
  it('splits text at sensible boundaries', () => {
    const text = `${'A'.repeat(60)}\n\n${'B'.repeat(60)}`;
    const chunks = chunkForDiscord(text, 100);

    expect(chunks).toEqual(['A'.repeat(60), 'B'.repeat(60)]);
    expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true);
  });

  it('preserves fenced code blocks across chunk boundaries', () => {
    const codeBlock = `\`\`\`ts\n${'const value = 1;\n'.repeat(25)}\`\`\``;
    const chunks = chunkForDiscord(codeBlock, 120);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.endsWith('```')).toBe(true);
    expect(chunks[1]?.startsWith('```')).toBe(true);
  });
});

describe('formatToolLine', () => {
  it('formats known tool summaries for Discord output', () => {
    const line = formatToolLine('running Bash {"command":"pnpm test"}');
    expect(line).toBe('> 💻 **Bash** `pnpm test`');
  });
});

describe('getToolIcon', () => {
  it('maps known tools and falls back for unknown tools', () => {
    expect(getToolIcon('Read')).toBe('📖');
    expect(getToolIcon('UnknownTool')).toBe('🔧');
  });
});
