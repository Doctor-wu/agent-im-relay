import { describe, expect, it } from 'vitest';

describe('Slack markdown formatting', () => {
  it('converts headings, links, and lists into readable mrkdwn', async () => {
    const { convertMarkdownToSlackMrkdwn } = await import('../formatting.js');

    const formatted = convertMarkdownToSlackMrkdwn([
      '# Release plan',
      '',
      '- finish setup',
      '- ship build',
      '',
      '[OpenAI](https://openai.com)',
    ].join('\n'));

    expect(formatted).toContain('*Release plan*');
    expect(formatted).toContain('• finish setup');
    expect(formatted).toContain('<https://openai.com|OpenAI>');
  });

  it('keeps code fences and downgrades tables into preformatted text', async () => {
    const { convertMarkdownToSlackMrkdwn } = await import('../formatting.js');

    const formatted = convertMarkdownToSlackMrkdwn([
      '| name | value |',
      '| --- | --- |',
      '| backend | codex |',
      '',
      '```ts',
      'console.log("ok")',
      '```',
    ].join('\n'));

    expect(formatted).toContain('```');
    expect(formatted).toContain('| name | value |');
    expect(formatted).toContain('console.log("ok")');
  });
});
