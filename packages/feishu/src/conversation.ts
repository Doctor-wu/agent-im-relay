export interface FeishuMessagePayload {
  chat_id: string;
  chat_type?: 'p2p' | 'group' | string;
  message_id: string;
  root_message_id?: string;
}

export interface FeishuActionPayload {
  value?: {
    conversationId?: string;
    [key: string]: unknown;
  };
}

export interface FeishuRawEvent {
  header?: {
    event_type?: string;
  };
  event?: {
    message?: FeishuMessagePayload;
  };
  action?: FeishuActionPayload;
}

export type NormalizedFeishuEvent =
  | {
    kind: 'message';
    chatId: string;
    chatType: string | undefined;
    messageId: string;
    rootMessageId?: string;
  }
  | {
    kind: 'action';
    conversationId?: string;
  };

export function normalizeFeishuEvent(event: FeishuRawEvent): NormalizedFeishuEvent {
  if (event.event?.message) {
    const message = event.event.message;
    return {
      kind: 'message',
      chatId: message.chat_id,
      chatType: message.chat_type,
      messageId: message.message_id,
      rootMessageId: message.root_message_id,
    };
  }

  return {
    kind: 'action',
    conversationId: event.action?.value?.conversationId,
  };
}

export function resolveConversationId(event: NormalizedFeishuEvent): string | undefined {
  if (event.kind !== 'message') return undefined;

  if (event.chatType === 'group' && event.rootMessageId) {
    return event.rootMessageId;
  }

  return event.chatId;
}

export function resolveConversationIdFromAction(event: NormalizedFeishuEvent): string | undefined {
  if (event.kind !== 'action') return undefined;
  return event.conversationId;
}
