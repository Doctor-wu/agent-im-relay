import type { MessageSender } from '@agent-im-relay/core';
import type { ILinkFetch } from './types';
import { ILINK_BASE_URL } from './types';
import type { ContextTokenCache } from './message-handler';

const MAX_MESSAGE_LENGTH = 2000;
const MAX_RETRIES = 2; // 2 retries = 3 total attempts
const RETRY_DELAY_MS = 1_000;

export class WeChatMessageSender implements MessageSender {
  readonly maxMessageLength = MAX_MESSAGE_LENGTH;

  private fetch: ILinkFetch;
  private contextTokenCache: ContextTokenCache;
  private sessionToken: string;

  constructor(fetch: ILinkFetch, contextTokenCache: ContextTokenCache, sessionToken: string) {
    this.fetch = fetch;
    this.contextTokenCache = contextTokenCache;
    this.sessionToken = sessionToken;
  }

  async send(conversationId: string, content: string, _extras?: unknown): Promise<string> {
    const userId = extractUserId(conversationId);
    const contextToken = this.contextTokenCache.get(userId);

    if (!contextToken) {
      console.warn(`[wechat] send skipped: no contextToken for user ${userId}`);
      return '';
    }

    const segments = segmentText(content, MAX_MESSAGE_LENGTH);
    let lastMsgId = '';

    for (const segment of segments) {
      lastMsgId = await this.sendSegment(userId, contextToken, segment);
    }

    return lastMsgId;
  }

  async edit(conversationId: string, _messageId: string, content: string, _extras?: unknown): Promise<void> {
    // WeChat has no message edit API — send a new message instead
    await this.send(conversationId, content);
  }

  private async sendSegment(toUser: string, contextToken: string, content: string): Promise<string> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.fetch(
          `${ILINK_BASE_URL}/messages/send`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.sessionToken}`,
            },
            body: JSON.stringify({
              toUser,
              contextToken,
              type: 'text',
              content,
            }),
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const body = await response.json() as { code: number; data?: { msgId: string } };
        if (body.code !== 0) {
          throw new Error(`iLink API error code ${body.code}`);
        }

        return body.data?.msgId ?? '';
      } catch (error) {
        if (attempt === MAX_RETRIES) {
          console.warn(`[wechat] sendSegment failed after ${MAX_RETRIES + 1} attempts:`, error);
          return '';
        }
        // Spec requires 1s delay between retries
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    return '';
  }
}

function extractUserId(conversationId: string): string {
  return conversationId.replace(/^wechat:/, '');
}

function segmentText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const segments: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    segments.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }

  return segments;
}
