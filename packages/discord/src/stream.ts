import type { Message } from 'discord.js';
import { stripArtifactManifest, type AgentEnvironment, type AgentStreamEvent } from '@agent-im-relay/core';
import { config } from './config.js';
import { buildDiscordReplyPayload, type DiscordReplyContext } from './reply-context.js';

export type StreamTargetChannel = {
  send(content: string | { content: string; embeds?: any[]; allowedMentions?: { users: string[] } }): Promise<Message<boolean>>;
};

type StreamToDiscordOptions = {
  channel: StreamTargetChannel;
  initialMessage?: Message<boolean>;
  showEnvironment?: boolean;
  replyContext?: DiscordReplyContext;
};

type EmbedFieldData = {
  name: string;
  value: string;
  inline: boolean;
};

export type EmbedData = {
  fields: EmbedFieldData[];
  color?: number;
};

type MarkdownConversionResult = {
  text: string;
  embeds: EmbedData[];
};

const ZERO_WIDTH_SPACE = '\u200B';

function capitalize(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

// --- Tool display formatting ---

const TOOL_ICONS: Record<string, string> = {
  Read: '📖',
  Write: '✏️',
  Edit: '✏️',
  MultiEdit: '✏️',
  Bash: '💻',
  Glob: '🔍',
  Grep: '🔍',
  LS: '📂',
  WebSearch: '🌐',
  WebFetch: '🌐',
  TodoRead: '📋',
  TodoWrite: '📋',
};

export function getToolIcon(name: string): string {
  return TOOL_ICONS[name] ?? '🔧';
}

function formatToolInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';

  const obj = input as Record<string, unknown>;

  if (name === 'Bash' && typeof obj.command === 'string') {
    const cmd = obj.command.length > 120 ? obj.command.slice(0, 117) + '...' : obj.command;
    return `\`${cmd}\``;
  }

  if ((name === 'Read' || name === 'Write' || name === 'Edit' || name === 'MultiEdit') && typeof obj.file_path === 'string') {
    return `\`${obj.file_path}\``;
  }

  if (name === 'Grep' && typeof obj.pattern === 'string') {
    const path = typeof obj.path === 'string' ? ` in \`${obj.path}\`` : '';
    return `\`${obj.pattern}\`${path}`;
  }

  if (name === 'Glob' && typeof obj.pattern === 'string') {
    return `\`${obj.pattern}\``;
  }

  if ((name === 'WebSearch' || name === 'WebFetch') && typeof obj.url === 'string') {
    return `<${obj.url}>`;
  }

  return '';
}

export function formatToolLine(summary: string): string {
  // Parse "running ToolName {...}" format from session.ts
  const match = summary.match(/^running (\w+)\s*(.*)/s);
  if (!match) {
    return `> 🔧 ${summary.length > 200 ? summary.slice(0, 197) + '...' : summary}`;
  }

  const name = match[1]!;
  const icon = getToolIcon(name);
  const rawInput = match[2]?.trim();

  let detail = '';
  if (rawInput) {
    try {
      const parsed = JSON.parse(rawInput);
      detail = formatToolInput(name, parsed);
    } catch {
      detail = rawInput.length > 150 ? rawInput.slice(0, 147) + '...' : rawInput;
    }
  }

  return detail ? `> ${icon} **${name}** ${detail}` : `> ${icon} **${name}**`;
}

// --- Chunking ---

export function chunkForDiscord(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    // Try to split at a double newline (paragraph boundary)
    let splitIndex = remaining.lastIndexOf('\n\n', maxLength);
    if (splitIndex < Math.floor(maxLength * 0.4)) {
      // Fall back to single newline
      splitIndex = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitIndex < Math.floor(maxLength * 0.4)) {
      splitIndex = maxLength;
    }

    // Don't split inside a code block - find the fence boundary
    const chunk = remaining.slice(0, splitIndex);
    const openFences = (chunk.match(/```/g) ?? []).length;
    if (openFences % 2 !== 0) {
      // Unclosed code block - close it in this chunk and reopen in next
      chunks.push(chunk + '\n```');
      remaining = '```\n' + remaining.slice(splitIndex).trimStart();
    } else {
      chunks.push(chunk);
      remaining = remaining.slice(splitIndex).trimStart();
    }
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function normalizeMarkdownSpacing(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const output: string[] = [];
  let inFence = false;

  const ensureBlankLine = () => {
    if (output.length > 0 && output[output.length - 1] !== '') {
      output.push('');
    }
  };

  for (const rawLine of lines) {
    const line = rawLine;
    const trimmed = line.trim();

    if (isFenceLine(line)) {
      if (!inFence) {
        ensureBlankLine();
      }
      output.push(line);
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      output.push(line);
      continue;
    }

    if (!trimmed) {
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
      continue;
    }

    const isHeading = /^#{1,6}\s/.test(trimmed);
    const isQuote = /^>\s?/.test(trimmed);
    const isList = /^([-*+]\s|\d+\.\s)/.test(trimmed);

    if (isHeading || isQuote) {
      ensureBlankLine();
      output.push(trimmed);
      continue;
    }

    if (isList) {
      output.push(trimmed);
      continue;
    }

    output.push(line);
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isFenceLine(line: string): boolean {
  return line.trimStart().startsWith('```');
}

function parseTableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) {
    return null;
  }

  let content = trimmed;
  if (content.startsWith('|')) {
    content = content.slice(1);
  }
  if (content.endsWith('|')) {
    content = content.slice(0, -1);
  }

  const cells = content.split('|').map(cell => cell.trim());
  return cells.length >= 2 ? cells : null;
}

function isTableSeparatorLine(line: string, columnCount: number): boolean {
  const cells = parseTableCells(line);
  if (!cells || cells.length !== columnCount) {
    return false;
  }

  return cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function normalizeTableCells(cells: string[], columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => cells[index] ?? '');
}

function buildTableEmbed(headers: string[], rows: string[][]): EmbedData | null {
  if (headers.length === 2) {
    return {
      fields: [
        {
          name: headers[0] || ZERO_WIDTH_SPACE,
          value: rows.map(row => row[0] || ZERO_WIDTH_SPACE).join('\n') || ZERO_WIDTH_SPACE,
          inline: true,
        },
        {
          name: ZERO_WIDTH_SPACE,
          value: ZERO_WIDTH_SPACE,
          inline: true,
        },
        {
          name: headers[1] || ZERO_WIDTH_SPACE,
          value: rows.map(row => row[1] || ZERO_WIDTH_SPACE).join('\n') || ZERO_WIDTH_SPACE,
          inline: true,
        },
      ],
    };
  }

  if (headers.length === 3) {
    return {
      fields: headers.map((header, index) => ({
        name: header || ZERO_WIDTH_SPACE,
        value: rows.map(row => row[index] || ZERO_WIDTH_SPACE).join('\n') || ZERO_WIDTH_SPACE,
        inline: true,
      })),
    };
  }

  return null;
}

function formatAlignedTableCodeBlock(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) => {
    const rowWidths = rows.map(row => row[index]?.length ?? 0);
    return Math.max(header.length, ...rowWidths);
  });

  const formatRow = (cells: string[]): string =>
    cells
      .map((cell, index) => cell.padEnd(widths[index] ?? cell.length))
      .join(' | ');

  const separator = widths.map(width => '-'.repeat(width)).join(' | ');

  return ['```', formatRow(headers), separator, ...rows.map(formatRow), '```'].join('\n');
}

export function convertMarkdownForDiscord(text: string): MarkdownConversionResult {
  const normalized = normalizeMarkdownSpacing(text);
  const lines = normalized.split('\n');
  const output: string[] = [];
  const embeds: EmbedData[] = [];
  let index = 0;
  let inFence = false;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (isFenceLine(line)) {
      output.push(line);
      inFence = !inFence;
      index += 1;
      continue;
    }

    if (inFence) {
      output.push(line);
      index += 1;
      continue;
    }

    const headerCells = parseTableCells(line);
    const separatorLine = lines[index + 1];
    if (
      headerCells
      && separatorLine !== undefined
      && isTableSeparatorLine(separatorLine, headerCells.length)
    ) {
      const tableRows: string[][] = [];
      let rowIndex = index + 2;

      while (rowIndex < lines.length) {
        const rowLine = lines[rowIndex] ?? '';
        if (isFenceLine(rowLine)) {
          break;
        }

        const rowCells = parseTableCells(rowLine);
        if (!rowCells) {
          break;
        }

        tableRows.push(normalizeTableCells(rowCells, headerCells.length));
        rowIndex += 1;
      }

      if (tableRows.length > 0) {
        const embed = buildTableEmbed(headerCells, tableRows);
        if (embed) {
          embeds.push(embed);

          const nextLine = lines[rowIndex];
          if (
            output.length > 0
            && output[output.length - 1] !== ''
            && nextLine !== undefined
            && nextLine.trim() !== ''
          ) {
            output.push('');
          }
        } else {
          output.push(formatAlignedTableCodeBlock(headerCells, tableRows));
        }
        index = rowIndex;
        continue;
      }
    }

    if (/^\s*---+\s*$/.test(line)) {
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
      index += 1;
      continue;
    }

    output.push(line);
    index += 1;
  }

  return {
    text: output.join('\n'),
    embeds,
  };
}

export function formatEnvironmentSummary(environment: AgentEnvironment): string {
  const cwd = environment.cwd.value ?? 'unknown';
  const cwdSuffix = environment.cwd.source === 'auto-detected'
    ? ' (auto-detected)'
    : environment.cwd.source === 'explicit'
      ? ' (manual override)'
      : '';
  const gitBranch = environment.git.isRepo
    ? environment.git.branch ?? 'unknown'
    : 'not a git repository';

  return [
    '## Environment',
    `- Backend: ${capitalize(environment.backend)}`,
    `- Model: default`,
    `- Working directory: ${cwd}${cwdSuffix}`,
    `- Git branch: ${gitBranch}`,
    `- Mode: ${environment.mode}`,
  ].join('\n');
}

// --- Streaming ---

export async function streamAgentToDiscord(
  options: StreamToDiscordOptions,
  events: AsyncIterable<AgentStreamEvent>,
): Promise<void> {
  const showEnvironment = options.showEnvironment ?? false;
  const messages: Message<boolean>[] = [];
  let environmentMessage: Message<boolean> | undefined;
  let mentionSent = false;
  if (options.initialMessage) {
    messages.push(options.initialMessage);
    mentionSent = true;
  }

  let buffer = '';
  let lastFlush = 0;
  let renderedChunks: string[] = [];
  let renderedEmbedsSignature = '[]';
  let toolCount = 0;
  let isThinking = false;
  let hasSubstantiveOutput = false;
  const maxLength = Math.max(200, config.discordMessageCharLimit);

  const flush = async (): Promise<void> => {
    const strippedBody = stripArtifactManifest(buffer).trim();
    if (
      options.replyContext
      && !mentionSent
      && messages.length === 0
      && !hasSubstantiveOutput
    ) {
      return;
    }

    const body = strippedBody || '⏳ Thinking...';
    const converted = convertMarkdownForDiscord(body);
    const embeds = converted.embeds as any[];
    const embedsSignature = JSON.stringify(converted.embeds);
    const displayText = converted.text.trim() ? converted.text : ZERO_WIDTH_SPACE;
    const chunks = chunkForDiscord(displayText, maxLength);

    if (messages.length === 0) {
      const firstChunk = chunks[0] ?? ZERO_WIDTH_SPACE;
      const first = await options.channel.send(
        !mentionSent
          ? buildDiscordReplyPayload(
              firstChunk,
              options.replyContext,
              embeds.length > 0 ? { embeds } : undefined,
            )
          : embeds.length > 0
            ? { content: firstChunk, embeds }
            : firstChunk,
      );
      messages.push(first);
      mentionSent = mentionSent || Boolean(options.replyContext);
    }

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index] ?? '';
      const current = messages[index];
      const previous = renderedChunks[index];

      if (!current) {
        const next = await options.channel.send(chunk || '…');
        messages.push(next);
        continue;
      }

      const shouldEdit = chunk !== previous || (index === 0 && embedsSignature !== renderedEmbedsSignature);

      if (shouldEdit) {
        const payload = index === 0
          ? { content: chunk || '…', embeds }
          : chunk || '…';

        await current.edit(payload).catch(() => {
          // Silently ignore edit failures (rate limits, deleted messages)
        });
      }
    }

    renderedChunks = chunks;
    renderedEmbedsSignature = embedsSignature;
    lastFlush = Date.now();
  };

  for await (const event of events) {
    if (event.type === 'environment') {
      if (!showEnvironment) {
        continue;
      }
      const content = formatEnvironmentSummary(event.environment);
      if (environmentMessage) {
        await environmentMessage.edit(content).catch(() => {});
      } else {
        environmentMessage = await options.channel.send(content);
      }
    } else if (event.type === 'text') {
      if (isThinking) {
        isThinking = false;
        buffer = '';
      }
      buffer += event.delta;
      hasSubstantiveOutput = hasSubstantiveOutput || stripArtifactManifest(buffer).trim().length > 0;
    } else if (event.type === 'tool') {
      toolCount++;
      buffer += '\n' + formatToolLine(event.summary) + '\n';
      hasSubstantiveOutput = true;
    } else if (event.type === 'status') {
      // Show thinking/status as subtle indicator, don't spam
      if (!isThinking && !buffer.trim()) {
        isThinking = true;
        buffer = '⏳ *' + event.status + '*';
      }
    } else if (event.type === 'error') {
      if (event.error === 'Agent request aborted') {
        buffer += '\n\n⏹️ 当前任务已中断。\n';
      } else {
        buffer += `\n\n❌ **Error:** ${event.error}\n`;
      }
      hasSubstantiveOutput = true;
    } else if (event.type === 'done') {
      if (!buffer.trim() && event.result) {
        buffer = event.result;
      }
      if (event.result && stripArtifactManifest(event.result).trim().length > 0) {
        hasSubstantiveOutput = true;
      }
      // Append tool count summary if tools were used
      if (toolCount > 0) {
        buffer += `\n-# 🔧 ${toolCount} tool${toolCount > 1 ? 's' : ''} used`;
      }
    }

    if (Date.now() - lastFlush >= config.streamUpdateIntervalMs) {
      await flush();
    }
  }

  await flush();
}
