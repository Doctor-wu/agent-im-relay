export interface FeishuMessagePayload {
  chat_id: string;
  chat_type?: 'p2p' | 'group' | string;
  message_id: string;
  root_message_id?: string;
  message_type?: string;
  content?: string;
  mentions?: Array<{
    name?: string;
    id?: {
      open_id?: string;
      union_id?: string;
      user_id?: string;
    };
  }>;
}

export interface FeishuActionPayload {
  value?: {
    conversationId?: string;
    action?: string;
    chatId?: string;
    replyToMessageId?: string;
    prompt?: string;
    mode?: 'code' | 'ask';
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

function parseMessageContent(content?: string): Record<string, unknown> {
  if (!content) return {};
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function extractFeishuMessageText(message: FeishuMessagePayload): string {
  const parsed = parseMessageContent(message.content);
  const rawText = typeof parsed.text === 'string' ? parsed.text : '';
  return rawText.replace(/@_user_\d+\s*/g, '').trim();
}

export function shouldProcessFeishuMessage(message: FeishuMessagePayload): boolean {
  if (message.chat_type !== 'group') {
    return true;
  }

  if (message.root_message_id) {
    return true;
  }

  if (message.mentions && message.mentions.length > 0) {
    return true;
  }

  const parsed = parseMessageContent(message.content);
  const rawText = typeof parsed.text === 'string' ? parsed.text : '';
  return /@_user_\d+/.test(rawText);
}

export function extractFeishuFileInfo(message: FeishuMessagePayload): {
  fileKey: string;
  fileName: string;
} | null {
  if (message.message_type !== 'file') {
    return null;
  }

  const parsed = parseMessageContent(message.content);
  const fileKey = typeof parsed.file_key === 'string' ? parsed.file_key : null;
  const fileName = typeof parsed.file_name === 'string'
    ? parsed.file_name
    : typeof parsed.name === 'string'
      ? parsed.name
      : 'attachment';

  if (!fileKey) {
    return null;
  }

  return {
    fileKey,
    fileName,
  };
}
