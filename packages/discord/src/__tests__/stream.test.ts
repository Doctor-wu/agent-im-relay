import { describe, expect, it, vi } from 'vitest';
import {
  chunkForDiscord,
  convertMarkdownForDiscord,
  formatToolLine,
  getToolIcon,
  streamAgentToDiscord,
} from '../stream.js';

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

describe('convertMarkdownForDiscord', () => {
  it('keeps markdown headings unchanged for Discord native rendering', () => {
    const input = ['Intro', '# Title', 'Body', '## Section', '### Detail'].join('\n');

    expect(convertMarkdownForDiscord(input)).toEqual({
      text: input,
      embeds: [],
    });
  });

  it('extracts two-column markdown tables into Discord embeds', () => {
    const input = [
      '| Name | Role |',
      '| --- | --- |',
      '| Alice | Admin |',
      '| Bob | User |',
    ].join('\n');

    expect(convertMarkdownForDiscord(input)).toEqual({
      text: '',
      embeds: [
        {
          fields: [
            { name: 'Name', value: 'Alice\nBob', inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: 'Role', value: 'Admin\nUser', inline: true },
          ],
        },
      ],
    });
  });

  it('extracts three-column markdown tables into Discord embeds', () => {
    const input = [
      '| Name | Role | Team |',
      '| --- | --- | --- |',
      '| Alice | Admin | Core |',
      '| Bob | User | Infra |',
    ].join('\n');

    expect(convertMarkdownForDiscord(input)).toEqual({
      text: '',
      embeds: [
        {
          fields: [
            { name: 'Name', value: 'Alice\nBob', inline: true },
            { name: 'Role', value: 'Admin\nUser', inline: true },
            { name: 'Team', value: 'Core\nInfra', inline: true },
          ],
        },
      ],
    });
  });

  it('falls back to an aligned code block for tables wider than three columns', () => {
    const input = [
      '| Name | Role | Team | Score |',
      '| --- | --- | --- | --- |',
      '| Alice | Admin | Core | 10 |',
      '| Bob | User | Infra | 8 |',
    ].join('\n');

    expect(convertMarkdownForDiscord(input)).toEqual({
      text: [
        '```',
        'Name  | Role  | Team  | Score',
        '----- | ----- | ----- | -----',
        'Alice | Admin | Core  | 10   ',
        'Bob   | User  | Infra | 8    ',
        '```',
      ].join('\n'),
      embeds: [],
    });
  });

  it('removes horizontal rules and leaves a blank line', () => {
    const input = ['Before', '---', 'After'].join('\n');

    expect(convertMarkdownForDiscord(input)).toEqual({
      text: ['Before', '', 'After'].join('\n'),
      embeds: [],
    });
  });

  it('preserves fenced code blocks exactly as-is', () => {
    const input = [
      '```md',
      '# Heading',
      '| Name | Role |',
      '| --- | --- |',
      '| Alice | Admin |',
      '---',
      '```',
    ].join('\n');

    expect(convertMarkdownForDiscord(input)).toEqual({
      text: input,
      embeds: [],
    });
  });

  it('handles mixed content with headings, rules, tables, and code fences', () => {
    const input = [
      'Summary',
      '## Results',
      '| Name | Score |',
      '| --- | --- |',
      '| Alice | 10 |',
      '| Bob | 8 |',
      '---',
      '```md',
      '# Keep this',
      '| Name | Score |',
      '| --- | --- |',
      '| Carol | 7 |',
      '```',
      '### Next',
      'Done',
    ].join('\n');

    expect(convertMarkdownForDiscord(input)).toEqual({
      text: [
        'Summary',
        '## Results',
        '',
        '```md',
        '# Keep this',
        '| Name | Score |',
        '| --- | --- |',
        '| Carol | 7 |',
        '```',
        '### Next',
        'Done',
      ].join('\n'),
      embeds: [
        {
          fields: [
            { name: 'Name', value: 'Alice\nBob', inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: 'Score', value: '10\n8', inline: true },
          ],
        },
      ],
    });
  });
});

describe('streamAgentToDiscord', () => {
  it('sends embeds alongside converted text content', async () => {
    const edit = vi.fn().mockResolvedValue(undefined);
    const message = { edit } as any;
    const send = vi.fn().mockResolvedValue(message);

    async function* events() {
      yield {
        type: 'text' as const,
        delta: [
          'Intro',
          '',
          '| Name | Role |',
          '| --- | --- |',
          '| Alice | Admin |',
          '| Bob | User |',
        ].join('\n'),
      };
      yield { type: 'done' as const };
    }

    await streamAgentToDiscord(
      { channel: { send } },
      events(),
    );

    expect(send).toHaveBeenCalledWith({
      content: expect.stringContaining('Intro'),
      embeds: [
        {
          fields: [
            { name: 'Name', value: 'Alice\nBob', inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: 'Role', value: 'Admin\nUser', inline: true },
          ],
        },
      ],
    });
  });

  it('renders agent aborts as controlled interruptions', async () => {
    const edit = vi.fn().mockResolvedValue(undefined);
    const message = { edit } as any;
    const send = vi.fn().mockResolvedValue(message);

    async function* events() {
      yield { type: 'error' as const, error: 'Agent request aborted' };
    }

    await streamAgentToDiscord(
      { channel: { send } },
      events(),
    );

    expect(send).toHaveBeenCalledWith(expect.stringContaining('⏹️ 当前任务已中断。'));
    expect(send).not.toHaveBeenCalledWith(expect.stringContaining('❌ **Error:** Agent request aborted'));
  });
});
