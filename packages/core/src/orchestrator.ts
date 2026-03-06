import type {
  PlatformAdapter,
  IncomingMessage,
  ConversationId,
  MessageId,
  FormattedContent,
} from './types.js';
import type { AgentStreamEvent } from './agent/session.js';

export type AgentSessionFactory = (conversationId: ConversationId, prompt: string) => AsyncGenerator<AgentStreamEvent, void>;

export interface OrchestratorOptions {
  flushIntervalMs?: number;
}

function chunkText(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf('\n\n', maxLength);
    if (splitIndex < Math.floor(maxLength * 0.4)) {
      splitIndex = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitIndex < Math.floor(maxLength * 0.4)) {
      splitIndex = maxLength;
    }

    const chunk = remaining.slice(0, splitIndex);
    const openFences = (chunk.match(/```/g) ?? []).length;
    if (openFences % 2 !== 0) {
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

function formatToolLine(summary: string): string {
  return `> 🔧 ${summary.length > 200 ? summary.slice(0, 197) + '...' : summary}`;
}

export class Orchestrator {
  private flushIntervalMs: number;

  constructor(options: OrchestratorOptions = {}) {
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
  }

  async handleMessage(
    adapter: PlatformAdapter,
    message: IncomingMessage,
    createAgentStream: AgentSessionFactory,
  ): Promise<{ sessionId?: string }> {
    // 1. Resolve conversation
    let conversationId = message.conversationId;

    if (!conversationId && adapter.conversationManager) {
      conversationId = await adapter.conversationManager.createConversation(message.id, {
        authorName: message.authorName,
        prompt: message.content,
      });
    }

    if (!conversationId) {
      conversationId = message.id; // Fallback: use message id as conversation
    }

    // 2. Set status
    await adapter.statusIndicator?.setStatus(conversationId, 'thinking', message.raw);

    // 3. Stream agent events
    const messages: MessageId[] = [];
    let buffer = '';
    let lastFlush = 0;
    let renderedChunks: string[] = [];
    let toolCount = 0;
    let isThinking = false;
    let sessionId: string | undefined;
    const maxLength = adapter.messageSender.maxMessageLength;

    const flush = async (): Promise<void> => {
      const body = buffer.trim() || '⏳ Thinking...';

      let formatted: FormattedContent;
      if (adapter.markdownFormatter) {
        formatted = adapter.markdownFormatter.format(body);
      } else {
        formatted = { text: body };
      }

      const displayText = formatted.text.trim() || ' ';
      const chunks = chunkText(displayText, maxLength);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i] ?? '';
        const existing = messages[i];
        const previous = renderedChunks[i];

        if (!existing) {
          const msgId = await adapter.messageSender.send(
            conversationId!,
            chunk,
            i === 0 ? formatted.extras : undefined,
          );
          messages.push(msgId);
        } else if (chunk !== previous) {
          await adapter.messageSender.edit(
            conversationId!,
            existing,
            chunk,
            i === 0 ? formatted.extras : undefined,
          ).catch(() => {});
        }
      }

      renderedChunks = chunks;
      lastFlush = Date.now();
    };

    try {
      const events = createAgentStream(conversationId, message.content);

      for await (const event of events) {
        if (event.type === 'text') {
          if (isThinking) {
            isThinking = false;
            buffer = '';
          }
          buffer += event.delta;
        } else if (event.type === 'tool') {
          toolCount++;
          buffer += '\n' + formatToolLine(event.summary) + '\n';
          await adapter.statusIndicator?.setStatus(conversationId, 'tool_running', message.raw);
        } else if (event.type === 'status') {
          if (!isThinking && !buffer.trim()) {
            isThinking = true;
            buffer = '⏳ *' + event.status + '*';
          }
        } else if (event.type === 'error') {
          buffer += `\n\n❌ **Error:** ${event.error}\n`;
          await adapter.statusIndicator?.setStatus(conversationId, 'error', message.raw);
        } else if (event.type === 'done') {
          if (!buffer.trim() && event.result) {
            buffer = event.result;
          }
          if (toolCount > 0) {
            buffer += `\n-# 🔧 ${toolCount} tool${toolCount > 1 ? 's' : ''} used`;
          }
          sessionId = event.sessionId;
        }

        if (Date.now() - lastFlush >= this.flushIntervalMs) {
          await flush();
        }
      }

      await flush();
      await adapter.statusIndicator?.setStatus(conversationId, 'done', message.raw);
    } finally {
      await adapter.statusIndicator?.clearStatus(conversationId, message.raw);
    }

    return { sessionId };
  }
}
