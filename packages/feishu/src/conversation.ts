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
    source?: 'card' | 'menu';
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
    chatId?: string;
    action?: string;
    source: 'card' | 'menu';
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
    chatId: event.action?.value?.chatId,
    action: event.action?.value?.action,
    source: event.action?.value?.source === 'menu' ? 'menu' : 'card',
  };
}

export type FeishuAttachmentInfo = {
  fileKey: string;
  fileName: string;
  resourceType: 'file' | 'image';
};

export function resolveConversationId(event: NormalizedFeishuEvent): string | undefined {
  if (event.kind !== 'message') return undefined;
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

function extractPostParagraphs(content: Record<string, unknown>): Record<string, unknown>[][] {
  const paragraphs: Record<string, unknown>[][] = [];

  for (const value of Object.values(content)) {
    if (!value || typeof value !== 'object') {
      continue;
    }

    const localizedContent = (value as { content?: unknown }).content;
    if (!Array.isArray(localizedContent)) {
      continue;
    }

    for (const paragraph of localizedContent) {
      if (!Array.isArray(paragraph)) {
        continue;
      }

      paragraphs.push(
        paragraph.filter((node): node is Record<string, unknown> => typeof node === 'object' && node !== null),
      );
    }
  }

  return paragraphs;
}

function extractPostTitle(content: Record<string, unknown>): string {
  for (const value of Object.values(content)) {
    if (!value || typeof value !== 'object') {
      continue;
    }

    const title = (value as { title?: unknown }).title;
    if (typeof title === 'string' && title.trim().length > 0) {
      return title.trim();
    }
  }

  return '';
}

function extractPostMessageText(content: Record<string, unknown>): string {
  const chunks: string[] = [];
  const title = extractPostTitle(content);
  if (title) {
    chunks.push(title);
  }

  for (const paragraph of extractPostParagraphs(content)) {
    for (const node of paragraph) {
      const tag = typeof node.tag === 'string' ? node.tag : '';
      const text = typeof node.text === 'string' ? node.text.trim() : '';
      if ((tag === 'text' || tag === 'a') && text.length > 0) {
        chunks.push(text);
      }
    }
  }

  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

function hasPostMention(content: Record<string, unknown>): boolean {
  return extractPostParagraphs(content)
    .some(paragraph => paragraph.some(node => node.tag === 'at'));
}

export function extractFeishuMessageText(message: FeishuMessagePayload): string {
  const parsed = parseMessageContent(message.content);
  if (message.message_type === 'post') {
    return extractPostMessageText(parsed);
  }

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
  if (message.message_type === 'post' && hasPostMention(parsed)) {
    return true;
  }

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

export function extractFeishuAttachmentInfos(message: FeishuMessagePayload): FeishuAttachmentInfo[] {
  const parsed = parseMessageContent(message.content);

  if (message.message_type === 'file') {
    const fileInfo = extractFeishuFileInfo(message);
    return fileInfo
      ? [{
        ...fileInfo,
        resourceType: 'file',
      }]
      : [];
  }

  if (message.message_type === 'image') {
    const imageKey = typeof parsed.image_key === 'string' ? parsed.image_key : null;
    if (!imageKey) {
      return [];
    }

    const fileName = typeof parsed.file_name === 'string'
      ? parsed.file_name
      : typeof parsed.name === 'string'
        ? parsed.name
        : 'image';

    return [{
      fileKey: imageKey,
      fileName,
      resourceType: 'image',
    }];
  }

  if (message.message_type !== 'post') {
    return [];
  }

  const attachments: FeishuAttachmentInfo[] = [];
  const seenKeys = new Set<string>();

  for (const paragraph of extractPostParagraphs(parsed)) {
    for (const node of paragraph) {
      if (node.tag !== 'img') {
        continue;
      }

      const imageKey = typeof node.image_key === 'string' ? node.image_key : null;
      if (!imageKey || seenKeys.has(imageKey)) {
        continue;
      }

      seenKeys.add(imageKey);
      attachments.push({
        fileKey: imageKey,
        fileName: 'image',
        resourceType: 'image',
      });
    }
  }

  return attachments;
}
