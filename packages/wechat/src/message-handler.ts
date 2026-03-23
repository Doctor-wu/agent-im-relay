import type { IncomingMessage } from '@agent-im-relay/core';
import type { ILinkMessage } from './types';

export function convertIncomingMessage(msg: ILinkMessage, _botName: string): IncomingMessage {
  let content: string;

  switch (msg.type) {
    case 'image':
      content = '[图片]';
      break;
    case 'file':
      content = msg.content ? `[文件] ${msg.content}` : '[文件]';
      break;
    case 'text':
      content = msg.content;
      break;
    default:
      content = msg.content || '';
      break;
  }

  return {
    id: msg.msgId,
    conversationId: `wechat:${msg.fromUser}`,
    content,
    authorId: msg.fromUser,
    authorName: msg.fromUserName,
    isBotMention: true, // WeChat is DM-only, always a bot mention
    raw: msg,
  };
}

export class ContextTokenCache {
  private tokens = new Map<string, string>();

  get(userId: string): string | undefined {
    return this.tokens.get(userId);
  }

  set(userId: string, token: string): void {
    this.tokens.set(userId, token);
  }

  updateFromMessage(msg: ILinkMessage): void {
    this.tokens.set(msg.fromUser, msg.contextToken);
  }
}
