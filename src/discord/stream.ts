import type { Message } from 'discord.js';
import type { AgentStreamEvent } from '../agent/session.js';
import { config } from '../config.js';

export type StreamTargetChannel = {
  send(content: string): Promise<Message<boolean>>;
};

type StreamToDiscordOptions = {
  channel: StreamTargetChannel;
  initialMessage?: Message<boolean>;
};

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

function getToolIcon(name: string): string {
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

function formatToolLine(summary: string): string {
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

function chunkForDiscord(text: string, maxLength: number): string[] {
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

// --- Streaming ---

export async function streamAgentToDiscord(
  options: StreamToDiscordOptions,
  events: AsyncIterable<AgentStreamEvent>,
): Promise<void> {
  const messages: Message<boolean>[] = [];
  if (options.initialMessage) {
    messages.push(options.initialMessage);
  }

  let buffer = '';
  let lastFlush = 0;
  let renderedChunks: string[] = [];
  let toolCount = 0;
  let isThinking = false;
  const maxLength = Math.max(200, config.discordMessageCharLimit);

  const flush = async (): Promise<void> => {
    const body = buffer.trim() || '⏳ Thinking...';
    const chunks = chunkForDiscord(body, maxLength);

    if (messages.length === 0) {
      const first = await options.channel.send(chunks[0] ?? '⏳ Thinking...');
      messages.push(first);
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

      if (chunk !== previous) {
        await current.edit(chunk || '…').catch(() => {
          // Silently ignore edit failures (rate limits, deleted messages)
        });
      }
    }

    renderedChunks = chunks;
    lastFlush = Date.now();
  };

  for await (const event of events) {
    if (event.type === 'text') {
      if (isThinking) {
        isThinking = false;
      }
      buffer += event.delta;
    } else if (event.type === 'tool') {
      toolCount++;
      buffer += '\n' + formatToolLine(event.summary) + '\n';
    } else if (event.type === 'status') {
      // Show thinking/status as subtle indicator, don't spam
      if (!isThinking && !buffer.trim()) {
        isThinking = true;
        buffer = '⏳ *' + event.status + '*';
      }
    } else if (event.type === 'error') {
      buffer += `\n\n❌ **Error:** ${event.error}\n`;
    } else if (event.type === 'done') {
      if (!buffer.trim() && event.result) {
        buffer = event.result;
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
