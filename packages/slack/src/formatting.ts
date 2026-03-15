const LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

function normalizeLine(line: string): string {
  if (/^#{1,6}\s+/.test(line)) {
    return `*${line.replace(/^#{1,6}\s+/, '').trim()}*`;
  }

  if (/^[-*+]\s+/.test(line)) {
    return `• ${line.replace(/^[-*+]\s+/, '').trim()}`;
  }

  return line.replace(LINK_PATTERN, (_match, label: string, url: string) => `<${url}|${label}>`);
}

function isTableLine(line: string): boolean {
  return /^\|.+\|$/.test(line.trim());
}

function normalizeTableBlock(lines: string[]): string[] {
  return ['```', ...lines, '```'];
}

export function convertMarkdownToSlackMrkdwn(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return '';
  }

  const output: string[] = [];
  const lines = normalized.split('\n');
  let insideCodeFence = false;
  let pendingTable: string[] = [];

  const flushTable = () => {
    if (pendingTable.length === 0) {
      return;
    }

    output.push(...normalizeTableBlock(pendingTable));
    pendingTable = [];
  };

  for (const line of lines) {
    if (/^```/.test(line)) {
      flushTable();
      insideCodeFence = !insideCodeFence;
      output.push(line);
      continue;
    }

    if (insideCodeFence) {
      output.push(line);
      continue;
    }

    if (isTableLine(line)) {
      pendingTable.push(line);
      continue;
    }

    flushTable();
    output.push(normalizeLine(line));
  }

  flushTable();
  return output.join('\n');
}
