import type {
  AgentStatus,
  ConversationId,
  FormattedContent,
  MarkdownFormatter,
  MessageId,
  MessageSender,
  PlatformAdapter,
  PromptInputOptions,
  SelectMenuOptions,
  StatusIndicator,
  ConversationManager,
  InteractiveUI,
} from '@agent-im-relay/core';
import { buildSlackConversationId, resolveSlackConversationIdForMessage, type SlackMessageEvent } from './conversation.js';
import { convertMarkdownToSlackMrkdwn } from './formatting.js';
import {
  consumeSlackTriggerContext,
  getSlackConversation,
  rememberSlackConversation,
  updateSlackStatusMessageTs,
  waitForSlackInteractiveValue,
} from './state.js';

type SlackMessagePayload = {
  channelId: string;
  threadTs?: string;
  text: string;
  blocks?: unknown;
};

type SlackUpdatePayload = {
  channelId: string;
  ts: string;
  text: string;
  blocks?: unknown;
};

export interface SlackTransport {
  createThread(args: {
    channelId: string;
    authorName: string;
    prompt: string;
  }): Promise<{
    channelId: string;
    threadTs: string;
    rootMessageTs: string;
  }>;
  sendMessage(payload: SlackMessagePayload): Promise<{ ts: string }>;
  updateMessage(payload: SlackUpdatePayload): Promise<void>;
  showSelectMenu(payload: {
    conversationId: string;
    channelId: string;
    threadTs: string;
    placeholder: string;
    options: SelectMenuOptions['options'];
  }): Promise<void>;
}

export interface SlackAdapterOptions {
  transport: SlackTransport;
}

function requireConversation(conversationId: string) {
  const conversation = getSlackConversation(conversationId);
  if (!conversation) {
    throw new Error(`Unknown Slack conversation: ${conversationId}`);
  }
  return conversation;
}

class SlackMessageSender implements MessageSender {
  readonly maxMessageLength = 40_000;

  constructor(private readonly transport: SlackTransport) {}

  async send(conversationId: ConversationId, content: string, extras?: unknown): Promise<MessageId> {
    const conversation = requireConversation(conversationId);
    const result = await this.transport.sendMessage({
      channelId: conversation.channelId,
      threadTs: conversation.threadTs,
      text: content,
      blocks: extras,
    });
    return result.ts;
  }

  async edit(conversationId: ConversationId, messageId: MessageId, content: string, extras?: unknown): Promise<void> {
    const conversation = requireConversation(conversationId);
    await this.transport.updateMessage({
      channelId: conversation.channelId,
      ts: messageId,
      text: content,
      blocks: extras,
    });
  }
}

class SlackConversationManager implements ConversationManager {
  constructor(private readonly transport: SlackTransport) {}

  async createConversation(triggerMessageId: MessageId, context: { authorName: string; prompt: string }): Promise<ConversationId> {
    const trigger = consumeSlackTriggerContext(triggerMessageId);
    if (!trigger) {
      throw new Error(`Missing Slack trigger context for ${triggerMessageId}`);
    }

    const created = await this.transport.createThread({
      channelId: trigger.channelId,
      authorName: context.authorName,
      prompt: context.prompt,
    });
    const conversationId = buildSlackConversationId(created.threadTs);

    rememberSlackConversation({
      conversationId,
      channelId: created.channelId,
      threadTs: created.threadTs,
      rootMessageTs: created.rootMessageTs,
    });
    return conversationId;
  }

  getConversationId(message: unknown): ConversationId | null {
    return resolveSlackConversationIdForMessage(message as SlackMessageEvent);
  }
}

class SlackStatusIndicator implements StatusIndicator {
  constructor(private readonly transport: SlackTransport) {}

  async setStatus(conversationId: ConversationId, status: AgentStatus): Promise<void> {
    const conversation = requireConversation(conversationId);
    const text = `status: ${status}`;

    if (conversation.statusMessageTs) {
      await this.transport.updateMessage({
        channelId: conversation.channelId,
        ts: conversation.statusMessageTs,
        text,
      });
      return;
    }

    const result = await this.transport.sendMessage({
      channelId: conversation.channelId,
      threadTs: conversation.threadTs,
      text,
    });
    updateSlackStatusMessageTs(conversationId, result.ts);
  }

  async clearStatus(conversationId: ConversationId): Promise<void> {
    const conversation = getSlackConversation(conversationId);
    if (!conversation?.statusMessageTs) {
      return;
    }

    await this.transport.updateMessage({
      channelId: conversation.channelId,
      ts: conversation.statusMessageTs,
      text: 'status: cleared',
    });
  }
}

class SlackInteractiveUI implements InteractiveUI {
  constructor(private readonly transport: SlackTransport) {}

  async showSelectMenu(conversationId: ConversationId, options: SelectMenuOptions): Promise<string> {
    const conversation = requireConversation(conversationId);
    const selectionPromise = waitForSlackInteractiveValue(conversationId);
    await this.transport.showSelectMenu({
      conversationId,
      channelId: conversation.channelId,
      threadTs: conversation.threadTs,
      placeholder: options.placeholder,
      options: options.options,
    });
    return selectionPromise;
  }

  async showPromptInput(_conversationId: ConversationId, _options: PromptInputOptions): Promise<string> {
    throw new Error('Slack prompt input is not implemented yet.');
  }
}

class SlackMarkdownFormatter implements MarkdownFormatter {
  format(markdown: string): FormattedContent {
    return {
      text: convertMarkdownToSlackMrkdwn(markdown),
    };
  }
}

export function createSlackAdapter(options: SlackAdapterOptions): PlatformAdapter {
  return {
    name: 'slack',
    messageSender: new SlackMessageSender(options.transport),
    conversationManager: new SlackConversationManager(options.transport),
    statusIndicator: new SlackStatusIndicator(options.transport),
    interactiveUI: new SlackInteractiveUI(options.transport),
    markdownFormatter: new SlackMarkdownFormatter(),
  };
}
