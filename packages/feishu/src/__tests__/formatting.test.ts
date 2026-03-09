import { describe, expect, it } from 'vitest';
import { formatFeishuTextMessages } from '../formatting.js';

function extractPostParagraphTexts(content: string): string[] {
  const parsed = JSON.parse(content) as {
    zh_cn?: {
      content?: Array<Array<{ tag?: string; text?: string }>>;
    };
  };

  return (parsed.zh_cn?.content ?? [])
    .map(paragraph => paragraph
      .filter(node => node.tag === 'text' && typeof node.text === 'string')
      .map(node => node.text ?? '')
      .join(''))
    .filter(Boolean);
}

describe('Feishu rich text formatting', () => {
  it('formats structured markdown-like output into post paragraphs', () => {
    const result = formatFeishuTextMessages([
      '# Summary',
      '',
      '第一段需要单独成段，不能和后面的列表糊在一起。',
      '',
      '- 保留列表结构',
      '- 让长消息更容易扫读',
      '',
      '> 引用内容也要保留层次',
      '> 不要和正文混成一段',
      '',
      'Design:',
      '保持 `packages/feishu` 本地实现。',
    ].join('\n'));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      msgType: 'post',
    });
    expect(extractPostParagraphTexts(result[0]!.content)).toEqual([
      '【Summary】',
      '第一段需要单独成段，不能和后面的列表糊在一起。',
      '• 保留列表结构',
      '• 让长消息更容易扫读',
      '> 引用内容也要保留层次',
      '> 不要和正文混成一段',
      '【Design】',
      '保持 `packages/feishu` 本地实现。',
    ]);
  });

  it('falls back to plain text when fenced code blocks are present', () => {
    const source = [
      '先看实现：',
      '',
      '```ts',
      'console.log("hello")',
      '```',
    ].join('\n');

    expect(formatFeishuTextMessages(source)).toEqual([
      {
        msgType: 'text',
        content: JSON.stringify({ text: source }),
      },
    ]);
  });
});
