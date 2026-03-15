import type { Client, Message, TextBasedChannel } from 'discord.js';
import type {
  PlatformAdapter,
  MessageSender,
  ConversationManager,
  StatusIndicator,
  MarkdownFormatter,
  ConversationId,
  MessageId,
  AgentStatus,
  FormattedContent,
} from '@agent-im-relay/core';
import { config } from './config';
import { convertMarkdownForDiscord, type EmbedData } from './stream';
import { ensureMentionThread } from './thread';

type SendableTextChannel = TextBasedChannel & {
  send(payload: string | { content: string; embeds?: any[] }): Promise<Message>;
  messages: { fetch(messageId: MessageId): Promise<Message | null> };
};

// --- Reaction-based status ---

const STATUS_REACTIONS: Record<AgentStatus, string> = {
  thinking: '🧠',
  tool_running: '🔧',
  done: '✅',
  error: '❌',
};

// --- MessageSender ---

class DiscordMessageSender implements MessageSender {
  readonly maxMessageLength: number;
  private client: Client;
  /** Cache sent Message objects for efficient editing */
  private messageCache = new Map<string, Message>();

  constructor(client: Client) {
    this.client = client;
    this.maxMessageLength = Math.max(200, config.discordMessageCharLimit);
  }

  private async resolveChannel(conversationId: ConversationId): Promise<SendableTextChannel> {
    const channel = await this.client.channels.fetch(conversationId);
    if (!channel?.isTextBased() || !('send' in channel) || !('messages' in channel)) {
      throw new Error(`Channel ${conversationId} is not text-based or not found`);
    }
    return channel as SendableTextChannel;
  }

  async send(conversationId: ConversationId, content: string, extras?: unknown): Promise<MessageId> {
    const channel = await this.resolveChannel(conversationId);
    const embeds = extras as EmbedData[] | undefined;
    const payload = embeds && embeds.length > 0
      ? { content, embeds: embeds as any[] }
      : content;
    const msg = await channel.send(payload);
    this.messageCache.set(msg.id, msg);
    return msg.id;
  }

  async edit(conversationId: ConversationId, messageId: MessageId, content: string, extras?: unknown): Promise<void> {
    let msg = this.messageCache.get(messageId);
    if (!msg) {
      const channel = await this.resolveChannel(conversationId);
      msg = await channel.messages.fetch(messageId);
      if (msg) this.messageCache.set(messageId, msg);
    }
    if (!msg) return;

    const embeds = extras as EmbedData[] | undefined;
    const payload = embeds && embeds.length > 0
      ? { content, embeds: embeds as any[] }
      : { content };
    await msg.edit(payload);
  }

  clearCache(): void {
    this.messageCache.clear();
  }
}

// --- StatusIndicator ---

class DiscordStatusIndicator implements StatusIndicator {
  private currentReactions = new Map<ConversationId, string>();
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  async setStatus(conversationId: ConversationId, status: AgentStatus, triggerMessageRaw?: unknown): Promise<void> {
    const msg = triggerMessageRaw as Message | undefined;
    if (!msg?.react) return;

    const emoji = STATUS_REACTIONS[status];
    const current = this.currentReactions.get(conversationId);

    try {
      if (current && current !== emoji) {
        await msg.reactions.cache.get(current)?.users.remove(this.client.user!.id).catch(() => {});
      }
      await msg.react(emoji);
      this.currentReactions.set(conversationId, emoji);
    } catch {
      // Silently ignore reaction failures
    }
  }

  async clearStatus(conversationId: ConversationId, _triggerMessageRaw?: unknown): Promise<void> {
    this.currentReactions.delete(conversationId);
  }
}

// --- ConversationManager ---

class DiscordConversationManager implements ConversationManager {
  async createConversation(triggerMessageId: MessageId, context: { authorName: string; prompt: string }): Promise<ConversationId> {
    // Thread creation is handled by the entry point, not here.
    // This is a fallback — return the trigger message ID.
    return triggerMessageId;
  }

  getConversationId(_message: unknown): ConversationId | null {
    return null;
  }
}

// --- MarkdownFormatter ---

class DiscordMarkdownFormatter implements MarkdownFormatter {
  format(markdown: string): FormattedContent {
    const result = convertMarkdownForDiscord(markdown);
    return {
      text: result.text,
      extras: result.embeds.length > 0 ? result.embeds : undefined,
    };
  }
}

// --- Composite adapter ---

export function createDiscordAdapter(client: Client): PlatformAdapter {
  return {
    name: 'discord',
    messageSender: new DiscordMessageSender(client),
    conversationManager: new DiscordConversationManager(),
    statusIndicator: new DiscordStatusIndicator(client),
    markdownFormatter: new DiscordMarkdownFormatter(),
  };
}
