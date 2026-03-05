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

function escapeCodeFence(input: string): string {
  return input.replaceAll('```', '`\u200b``');
}

function formatToolBlock(summary: string): string {
  const cleaned = escapeCodeFence(summary.trim());
  return `\n\n\`\`\`tool\n${cleaned}\n\`\`\`\n`;
}

function chunkForDiscord(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf('\n', maxLength);
    if (splitIndex < Math.floor(maxLength * 0.6)) {
      splitIndex = maxLength;
    }
    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  chunks.push(remaining);
  return chunks;
}

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
  const maxLength = Math.max(200, config.discordMessageCharLimit);

  const flush = async (): Promise<void> => {
    const body = buffer.trim() || '…';
    const chunks = chunkForDiscord(body, maxLength);

    if (messages.length === 0) {
      const first = await options.channel.send(chunks[0] ?? '…');
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
        await current.edit(chunk || '…');
      }
    }

    renderedChunks = chunks;
    lastFlush = Date.now();
  };

  for await (const event of events) {
    if (event.type === 'text') {
      buffer += event.delta;
    } else if (event.type === 'tool') {
      buffer += formatToolBlock(event.summary);
    } else if (event.type === 'status') {
      buffer += `\n\n_${event.status}_\n`;
    } else if (event.type === 'error') {
      buffer += `\n\n❌ ${event.error}\n`;
    } else if (event.type === 'done' && event.result && !buffer.trim()) {
      buffer = event.result;
    }

    if (Date.now() - lastFlush >= config.streamUpdateIntervalMs) {
      await flush();
    }
  }

  await flush();
}
