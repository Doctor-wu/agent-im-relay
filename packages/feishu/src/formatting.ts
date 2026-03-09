export type FeishuFormattedTextMessage = {
  msgType: 'text' | 'post';
  content: string;
};

const CODE_FENCE_PATTERN = /^```/m;
const MAX_POST_PARAGRAPHS = 20;
const MAX_POST_CHARS = 4_000;
const MAX_PARAGRAPH_CHARS = 900;

function buildTextMessage(text: string): FeishuFormattedTextMessage {
  return {
    msgType: 'text',
    content: JSON.stringify({ text }),
  };
}

function buildPostMessage(paragraphs: string[]): FeishuFormattedTextMessage {
  return {
    msgType: 'post',
    content: JSON.stringify({
      zh_cn: {
        title: '',
        content: paragraphs.map(text => [{ tag: 'text', text }]),
      },
    }),
  };
}

function normalizeInput(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

function isHeadingLine(line: string): boolean {
  return /^#{1,6}\s+/.test(line);
}

function isBulletListLine(line: string): boolean {
  return /^[-*+]\s+/.test(line);
}

function isNumberedListLine(line: string): boolean {
  return /^\d+\.\s+/.test(line);
}

function isQuoteLine(line: string): boolean {
  return /^>\s?/.test(line);
}

function isLabelLine(line: string): boolean {
  return !isBulletListLine(line)
    && !isNumberedListLine(line)
    && !isQuoteLine(line)
    && line.length <= 80
    && /^[^\s].*[:：]$/.test(line);
}

function emphasizeLabel(text: string): string {
  const normalized = text
    .replace(/^#{1,6}\s+/, '')
    .replace(/[:：]\s*$/, '')
    .trim();
  return normalized ? `【${normalized}】` : '';
}

function normalizeListItem(line: string): string {
  if (isBulletListLine(line)) {
    return `• ${line.replace(/^[-*+]\s+/, '').trim()}`;
  }

  if (isNumberedListLine(line)) {
    const match = line.match(/^(\d+\.)\s+(.*)$/);
    if (!match) return line;
    return `${match[1]} ${match[2].trim()}`;
  }

  return line;
}

function splitLongParagraph(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf(' ', maxLength);
    if (splitIndex < Math.floor(maxLength * 0.5)) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks.filter(Boolean);
}

function collectParagraphs(text: string): string[] {
  const paragraphs: string[] = [];
  const current: string[] = [];
  const lines = text.split('\n');

  const flushCurrent = () => {
    if (current.length === 0) {
      return;
    }

    const paragraph = current.join(' ').replace(/\s+/g, ' ').trim();
    current.length = 0;
    if (!paragraph) {
      return;
    }

    paragraphs.push(...splitLongParagraph(paragraph, MAX_PARAGRAPH_CHARS));
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushCurrent();
      continue;
    }

    if (isHeadingLine(line) || isLabelLine(line)) {
      flushCurrent();
      const heading = emphasizeLabel(line);
      if (heading) {
        paragraphs.push(heading);
      }
      continue;
    }

    if (isBulletListLine(line) || isNumberedListLine(line)) {
      flushCurrent();
      paragraphs.push(normalizeListItem(line));
      continue;
    }

    if (isQuoteLine(line)) {
      flushCurrent();
      paragraphs.push(`> ${line.replace(/^>\s?/, '').trim()}`);
      continue;
    }

    current.push(line);
  }

  flushCurrent();
  return paragraphs;
}

function chunkParagraphs(paragraphs: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const paragraph of paragraphs) {
    const nextLength = currentLength + paragraph.length;
    if (
      current.length > 0
      && (current.length >= MAX_POST_PARAGRAPHS || nextLength > MAX_POST_CHARS)
    ) {
      chunks.push(current);
      current = [];
      currentLength = 0;
    }

    current.push(paragraph);
    currentLength += paragraph.length;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

export function formatFeishuTextMessages(text: string): FeishuFormattedTextMessage[] {
  const normalized = normalizeInput(text);
  if (!normalized) {
    return [];
  }

  if (CODE_FENCE_PATTERN.test(normalized)) {
    return [buildTextMessage(normalized)];
  }

  const paragraphs = collectParagraphs(normalized);
  if (paragraphs.length === 0) {
    return [buildTextMessage(normalized)];
  }

  return chunkParagraphs(paragraphs).map(buildPostMessage);
}
