import { describe, expect, it, vi } from 'vitest';
import {
  chunkForDiscord,
  convertMarkdownForDiscord,
  formatEnvironmentSummary,
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
      text: [
        'Intro',
        '',
        '# Title',
        'Body',
        '',
        '## Section',
        '',
        '### Detail',
      ].join('\n'),
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

  it('normalizes heading, quote, and code fence spacing for Discord output', () => {
    const input = [
      'Intro',
      '## Plan',
      '- item 1',
      '- item 2',
      '> note',
      '```ts',
      'const x = 1',
      '```',
    ].join('\n');

    expect(convertMarkdownForDiscord(input)).toEqual({
      text: [
        'Intro',
        '',
        '## Plan',
        '- item 1',
        '- item 2',
        '',
        '> note',
        '',
        '```ts',
        'const x = 1',
        '```',
      ].join('\n'),
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
        '',
        '## Results',
        '',
        '',
        '```md',
        '# Keep this',
        '| Name | Score |',
        '| --- | --- |',
        '| Carol | 7 |',
        '```',
        '',
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

describe('formatEnvironmentSummary', () => {
  it('formats backend-provided environment details for Discord', () => {
    expect(formatEnvironmentSummary({
      backend: 'codex',
      mode: 'code',
      model: { requested: 'gpt-5-codex' },
      cwd: { value: '/tmp/project', source: 'auto-detected' },
      git: { isRepo: true, branch: 'feature/demo', repoRoot: '/tmp/project' },
    })).toBe([
      '## Environment',
      '- Backend: Codex',
      '- Model: gpt-5-codex',
      '- Working directory: /tmp/project (auto-detected)',
      '- Git branch: feature/demo',
      '- Mode: code',
    ].join('\n'));
  });
});

describe('streamAgentToDiscord', () => {
  it('renders environment events as a standalone summary message', async () => {
    const edit = vi.fn().mockResolvedValue(undefined);
    const message = { edit } as any;
    const send = vi.fn().mockResolvedValue(message);

    async function* events() {
      yield {
        type: 'environment' as const,
        environment: {
          backend: 'codex' as const,
          mode: 'code' as const,
          model: { requested: 'gpt-5-codex' },
          cwd: { value: '/tmp/project', source: 'auto-detected' as const },
          git: { isRepo: true, branch: 'feature/demo', repoRoot: '/tmp/project' },
        },
      };
      yield { type: 'text' as const, delta: '## Done\n- item 1\n- item 2' };
      yield { type: 'done' as const, result: '## Done\n- item 1\n- item 2' };
    }

    await streamAgentToDiscord(
      { channel: { send }, showEnvironment: true },
      events(),
    );

    expect(send).toHaveBeenNthCalledWith(1, expect.stringContaining('## Environment'));
  });

  it('skips visible environment output when disabled', async () => {
    const edit = vi.fn().mockResolvedValue(undefined);
    const message = { edit } as any;
    const send = vi.fn().mockResolvedValue(message);

    async function* events() {
      yield {
        type: 'environment' as const,
        environment: {
          backend: 'codex' as const,
          mode: 'code' as const,
          model: { requested: 'gpt-5-codex' },
          cwd: { value: '/tmp/project', source: 'auto-detected' as const },
          git: { isRepo: true, branch: 'feature/demo', repoRoot: '/tmp/project' },
        },
      };
      yield { type: 'text' as const, delta: '## Done\n- item 1\n- item 2' };
      yield { type: 'done' as const, result: '## Done\n- item 1\n- item 2' };
    }

    await streamAgentToDiscord(
      { channel: { send }, showEnvironment: false },
      events(),
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.not.stringContaining('## Environment'));
    expect(send).toHaveBeenCalledWith(expect.stringContaining('## Done'));
  });

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

  it('removes artifacts fenced blocks from the rendered final message', async () => {
    const edit = vi.fn().mockResolvedValue(undefined);
    const message = { edit } as any;
    const send = vi.fn().mockResolvedValue(message);

    async function* events() {
      yield {
        type: 'text' as const,
        delta: [
          'Here is your summary.',
          '',
          '```artifacts',
          '{ "files": [{ "path": "reports/summary.md" }] }',
          '```',
        ].join('\n'),
      };
      yield {
        type: 'done' as const,
        result: [
          'Here is your summary.',
          '',
          '```artifacts',
          '{ "files": [{ "path": "reports/summary.md" }] }',
          '```',
        ].join('\n'),
      };
    }

    await streamAgentToDiscord(
      { channel: { send } },
      events(),
    );

    expect(send).toHaveBeenCalledWith('Here is your summary.');
    expect(edit).not.toHaveBeenCalledWith(expect.stringContaining('```artifacts'));
  });
});
