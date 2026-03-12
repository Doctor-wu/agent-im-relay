import { findSlackConversationByThreadTs } from './state.js';

export interface SlackMessageEvent {
  channel: string;
  ts: string;
  thread_ts?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  text?: string;
}

export function buildSlackConversationId(threadTs: string): string {
  return threadTs;
}

export function resolveSlackConversationIdForMessage(message: SlackMessageEvent): string | null {
  if (!message.thread_ts) {
    return null;
  }

  return findSlackConversationByThreadTs(message.thread_ts)?.conversationId ?? null;
}

export function shouldProcessSlackMessage(message: SlackMessageEvent): boolean {
  if (message.bot_id || message.subtype === 'bot_message') {
    return false;
  }

  if (!message.user || !message.thread_ts) {
    return false;
  }

  return resolveSlackConversationIdForMessage(message) !== null;
}
