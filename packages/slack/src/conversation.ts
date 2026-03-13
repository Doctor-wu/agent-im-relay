import { findSlackConversationByThreadTs } from './state.js';

export interface SlackMessageEvent {
  channel: string;
  channel_type?: 'im' | 'channel' | 'group' | string;
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

export function isSlackDirectMessage(message: SlackMessageEvent): boolean {
  return message.channel_type === 'im' || message.channel.startsWith('D');
}

export function shouldProcessSlackMessage(message: SlackMessageEvent): boolean {
  if (message.bot_id || message.subtype === 'bot_message') {
    return false;
  }

  if (!message.user) {
    return false;
  }

  if (isSlackDirectMessage(message)) {
    return true;
  }

  if (!message.thread_ts) {
    return false;
  }

  return resolveSlackConversationIdForMessage(message) !== null;
}
