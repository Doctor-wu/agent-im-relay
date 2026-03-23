import type {
  PlatformAdapter,
  MessageSender,
  InteractiveUI,
  MarkdownFormatter,
  IncomingMessage,
  FormattedContent,
  SelectMenuOptions,
  PromptInputOptions,
} from '@agent-im-relay/core';
import type { WeChatConfig } from './config';
import type { ILinkFetch } from './qr-auth';
import type { ILinkClientEvent } from './types';
import { ILinkClient } from './ilink-client';
import { WeChatMessageSender } from './message-sender';
import { convertIncomingMessage, ContextTokenCache } from './message-handler';
import { TextInteractionStrategy } from './interaction';

type MessageHandler = (message: IncomingMessage) => void;
type StatusHandler = (status: string) => void;

export class WeChatAdapter implements PlatformAdapter {
  readonly name = 'wechat';
  readonly messageSender: MessageSender;
  readonly interactiveUI: InteractiveUI;
  readonly markdownFormatter: MarkdownFormatter;

  private config: WeChatConfig;
  private client: ILinkClient;
  private contextTokenCache: ContextTokenCache;
  private sender: WeChatMessageSender;
  private interaction: TextInteractionStrategy;
  private messageHandlers: MessageHandler[] = [];
  private statusHandlers: StatusHandler[] = [];

  constructor(config: WeChatConfig, fetch: ILinkFetch) {
    this.config = config;
    this.contextTokenCache = new ContextTokenCache();
    this.client = new ILinkClient(config, fetch);
    this.sender = new WeChatMessageSender(fetch, this.contextTokenCache, config.sessionToken ?? '');
    this.messageSender = this.sender;

    this.interaction = new TextInteractionStrategy(
      async (convId, text) => { await this.sender.send(convId, text); },
      { selectionTimeoutMs: config.selectionTimeoutMs },
    );

    this.interactiveUI = {
      showSelectMenu: async (conversationId: string, options: SelectMenuOptions): Promise<string> => {
        const result = await this.interaction.startSelection(conversationId, options);
        return result.value;
      },
      showPromptInput: async (_conversationId: string, _options: PromptInputOptions): Promise<string> => {
        return '';
      },
    };

    this.markdownFormatter = {
      format: (markdown: string): FormattedContent => {
        return { text: convertMarkdownToPlainText(markdown) };
      },
    };

    this.client.onEvent((event) => this.handleClientEvent(event));
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  onStatusChange(handler: StatusHandler): void {
    this.statusHandlers.push(handler);
  }

  async start(): Promise<void> {
    await this.client.connect();
  }

  stop(): void {
    this.client.disconnect();
  }

  private handleClientEvent(event: ILinkClientEvent): void {
    switch (event.type) {
      case 'connected':
        this.emitStatus('connected');
        break;
      case 'disconnected':
        this.emitStatus('disconnected');
        break;
      case 'message': {
        const msg = event.data;
        this.contextTokenCache.updateFromMessage(msg);
        const incoming = convertIncomingMessage(msg, this.config.name);

        // Check if interaction strategy intercepts this message
        if (this.interaction.isWaiting(incoming.conversationId!)) {
          this.interaction.handleInput(incoming.conversationId!, incoming.content);
          return;
        }

        for (const handler of this.messageHandlers) {
          handler(incoming);
        }
        break;
      }
      case 'error':
        this.emitStatus('error');
        break;
    }
  }

  private emitStatus(status: string): void {
    for (const handler of this.statusHandlers) {
      handler(status);
    }
  }
}

function convertMarkdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\*\*(.*?)\*\*/g, '$1')       // bold
    .replace(/\*(.*?)\*/g, '$1')            // italic
    .replace(/~~(.*?)~~/g, '$1')            // strikethrough
    .replace(/`{3}[\s\S]*?`{3}/g, (m) =>   // code blocks: keep content
      m.replace(/^`{3}\w*\n?/, '').replace(/\n?`{3}$/, ''))
    .replace(/`(.*?)`/g, '$1')              // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links: keep text
    .replace(/^#{1,6}\s+/gm, '')            // headers
    .replace(/^[-*+]\s+/gm, '• ')           // unordered lists
    .replace(/^\d+\.\s+/gm, (m) => m);     // ordered lists: keep as-is
}
