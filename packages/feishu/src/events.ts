import { readFile } from 'node:fs/promises';
import { initState, persistState } from '@agent-im-relay/core';
import { createFeishuClient } from './api.js';
import type { FeishuConfig } from './config.js';
import {
  buildFeishuBackendConfirmationCardPayload,
} from './cards.js';
import {
  extractFeishuFileInfo,
  extractFeishuMessageText,
  normalizeFeishuEvent,
  resolveConversationId,
  resolveConversationIdFromAction,
  shouldProcessFeishuMessage,
  type FeishuActionPayload,
  type FeishuMessagePayload,
  type FeishuRawEvent,
} from './conversation.js';
import {
  buildFeishuSessionChatRecord,
  findFeishuSessionChatBySourceMessage,
  initializeFeishuSessionChats,
  persistFeishuSessionChats,
  rememberFeishuSessionChat,
  resolveFeishuChatSessionKind,
} from './session-chat.js';
import {
  buildFeishuCardContext,
  drainPendingFeishuAttachments,
  handleFeishuControlAction,
  openFeishuSessionControlPanel,
  isFeishuDoneCommand,
  queuePendingFeishuAttachments,
  resumePendingFeishuRun,
  resolveFeishuMessageRequest,
  runFeishuConversation,
  type FeishuRuntimeTransport,
  type FeishuTarget,
} from './runtime.js';

type FeishuClient = ReturnType<typeof createFeishuClient>;

export const FEISHU_MESSAGE_EVENT_TYPE = 'im.message.receive_v1';
export const FEISHU_CARD_ACTION_EVENT_TYPE = 'card.action.trigger';
export const FEISHU_MENU_ACTION_EVENT_TYPE = 'application.bot.menu_v6';

export type FeishuMessageReceiveEvent = {
  sender?: {
    sender_id?: {
      open_id?: string;
      union_id?: string;
      user_id?: string;
    };
  };
  message: {
    message_id: string;
    root_id?: string;
    chat_id: string;
    chat_type?: 'p2p' | 'group' | string;
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
  };
};

export type FeishuCardActionTriggerEvent = {
  open_id?: string;
  user_id?: string;
  open_message_id?: string;
  action?: {
    value?: Record<string, unknown>;
    tag?: string;
    option?: string;
    timezone?: string;
  };
};

export type FeishuMenuActionTriggerEvent = {
  event_key?: string;
  chat_id?: string;
};

type RouterDependencies = {
  client?: FeishuClient;
  readFileImpl?: typeof readFile;
};

function resolveSenderOpenId(payload: FeishuMessageReceiveEvent): string | undefined {
  return payload.sender?.sender_id?.open_id;
}

function buildSessionChatName(messageId: string, prompt: string): string {
  const promptPreview = prompt.trim().replace(/\s+/g, ' ').slice(0, 40) || 'New session';
  const suffix = messageId.slice(-4);
  return `Session · ${promptPreview} · ${suffix}`;
}

function buildPrivateChatIndexText(options: {
  sessionChatName: string;
  sessionChatId: string;
  promptPreview: string;
  createdAt: string;
}): string {
  return [
    `Session created: ${options.sessionChatName} (${options.sessionChatId})`,
    `Prompt: ${options.promptPreview}`,
    `Created: ${options.createdAt}`,
  ].join('\n');
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return 'unknown error';
}

function shouldFallbackToChatSend(error: unknown): boolean {
  return error instanceof Error
    && /Feishu reply message failed with HTTP 400(?:[.:]|$)/.test(error.message);
}

async function withReplyFallback<T>(
  target: FeishuTarget,
  attemptReply: () => Promise<T>,
  attemptChatSend: () => Promise<T>,
): Promise<T> {
  if (!target.replyToMessageId) {
    return attemptChatSend();
  }

  try {
    return await attemptReply();
  } catch (error) {
    if (!shouldFallbackToChatSend(error)) {
      throw error;
    }

    return attemptChatSend();
  }
}

function createTransport(
  client: FeishuClient,
  readFileImpl: typeof readFile,
): FeishuRuntimeTransport {
  async function sendText(target: FeishuTarget, content: string): Promise<void> {
    await withReplyFallback(
      target,
      async () => {
        await client.replyMessage({
          messageId: target.replyToMessageId!,
          msgType: 'text',
          content: JSON.stringify({ text: content }),
        });
      },
      async () => {
        await client.sendMessage({
          receiveId: target.chatId,
          msgType: 'text',
          content: JSON.stringify({ text: content }),
        });
      },
    );
  }

  async function sendCard(target: FeishuTarget, card: Record<string, unknown>): Promise<string | undefined> {
    return withReplyFallback(
      target,
      async () => {
        return client.replyMessage({
          messageId: target.replyToMessageId!,
          msgType: 'interactive',
          content: JSON.stringify(card),
        });
      },
      async () => {
        return client.sendCard(target.chatId, card);
      },
    );
  }

  async function updateCard(target: FeishuTarget, messageId: string, card: Record<string, unknown>): Promise<void> {
    await client.updateCardMessage(messageId, card);
  }

  async function uploadFile(target: FeishuTarget, filePath: string): Promise<void> {
    const buffer = await readFileImpl(filePath);
    const fileKey = await client.uploadFileContent({
      fileName: filePath.split('/').pop() ?? 'artifact',
      data: buffer,
    });

    await withReplyFallback(
      target,
      async () => {
        await client.replyMessage({
          messageId: target.replyToMessageId!,
          msgType: 'file',
          content: JSON.stringify({ file_key: fileKey }),
        });
      },
      async () => {
        await client.sendFileMessage(target.chatId, fileKey);
      },
    );
  }

  return {
    sendText,
    sendCard,
    updateCard,
    uploadFile,
  };
}

async function buildManagedAttachment(
  client: FeishuClient,
  messageId: string,
  fileInfo: { fileKey: string; fileName: string },
): Promise<{
  fileKey: string;
  name: string;
  url: string;
  contentType?: string;
  size?: number;
}> {
  const response = await client.downloadMessageResource(messageId, fileInfo.fileKey);
  if (!response.ok) {
    throw new Error(`Failed to download Feishu attachment: ${fileInfo.fileName}`);
  }

  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    fileKey: fileInfo.fileKey,
    name: fileInfo.fileName,
    url: `data:${contentType};base64,${buffer.toString('base64')}`,
    contentType,
    size: buffer.byteLength,
  };
}

export function normalizeFeishuMessageReceiveEvent(payload: FeishuMessageReceiveEvent): FeishuRawEvent {
  return {
    event: {
      message: {
        message_id: payload.message.message_id,
        root_message_id: payload.message.root_id,
        chat_id: payload.message.chat_id,
        chat_type: payload.message.chat_type,
        message_type: payload.message.message_type,
        content: payload.message.content,
        mentions: payload.message.mentions,
      },
    },
  };
}

export function normalizeFeishuCardActionTriggerEvent(payload: FeishuCardActionTriggerEvent): FeishuRawEvent {
  const actionValue = payload.action?.value ?? {};
  return {
    action: {
      value: {
        ...actionValue,
        replyToMessageId: typeof actionValue.replyToMessageId === 'string'
          ? actionValue.replyToMessageId
          : payload.open_message_id,
      },
    },
  };
}

export function normalizeFeishuMenuActionTriggerEvent(payload: FeishuMenuActionTriggerEvent): FeishuRawEvent {
  return {
    action: {
      value: {
        source: 'menu',
        action: payload.event_key,
        chatId: payload.chat_id,
        conversationId: payload.chat_id,
      },
    },
  };
}

export function createFeishuEventRouter(
  config: FeishuConfig,
  dependencies: RouterDependencies = {},
) {
  const client = dependencies.client ?? createFeishuClient(config);
  const readFileImpl = dependencies.readFileImpl ?? readFile;
  const transport = createTransport(client, readFileImpl);
  let initialized = false;

  async function ensureInitialized(): Promise<void> {
    if (initialized) {
      return;
    }

    await initState();
    await initializeFeishuSessionChats(config.stateFile);
    initialized = true;
  }

  async function handleMessageEvent(payload: FeishuMessageReceiveEvent): Promise<void> {
    await ensureInitialized();
    const rawEvent = normalizeFeishuMessageReceiveEvent(payload);
    const event = normalizeFeishuEvent(rawEvent);
    const message = rawEvent.event?.message;
    if (event.kind !== 'message' || !message) {
      return;
    }

    const conversationId = resolveConversationId(event);
    if (!conversationId) {
      return;
    }

    const target = {
      chatId: message.chat_id,
      replyToMessageId: message.message_id,
    };

    const fileInfo = extractFeishuFileInfo(message);
    if (fileInfo) {
      queuePendingFeishuAttachments(
        conversationId,
        [await buildManagedAttachment(client, message.message_id, fileInfo)],
      );
      await transport.sendText(target, 'File received. Send a prompt to use it.');
      return;
    }

    const sessionKind = resolveFeishuChatSessionKind({
      chatId: message.chat_id,
      chatType: message.chat_type,
    });

    if (sessionKind.kind !== 'session-chat' && !shouldProcessFeishuMessage(message)) {
      return;
    }

    const messageText = extractFeishuMessageText(message);

    if (isFeishuDoneCommand(messageText)) {
      if (message.chat_type === 'p2p') {
        await transport.sendText(target, 'Use /done inside the session chat you want to close.');
        return;
      }

      await handleFeishuControlAction({
        action: {
          conversationId,
          type: 'done',
        },
        target,
        transport,
        persist: persistState,
      });
      return;
    }

    const request = resolveFeishuMessageRequest(messageText);
    if (!request.prompt) {
      await transport.sendText(target, 'Please include a prompt after mentioning the bot.');
      return;
    }

    if (message.chat_type === 'p2p') {
      const duplicateSessionChat = findFeishuSessionChatBySourceMessage({
        sourceP2pChatId: message.chat_id,
        sourceMessageId: message.message_id,
      });
      if (duplicateSessionChat) {
        return;
      }

      const creatorOpenId = resolveSenderOpenId(payload);
      if (!creatorOpenId) {
        await transport.sendText(target, 'Could not determine the Feishu user for this private chat.');
        return;
      }

      const sessionChatName = buildSessionChatName(message.message_id, request.prompt);
      let sessionChat: { chatId: string; name?: string };
      try {
        sessionChat = await client.createSessionChat({
          name: sessionChatName,
          userOpenId: creatorOpenId,
        });
      } catch (error) {
        await transport.sendText(target, `Could not create session chat: ${describeError(error)}`);
        return;
      }

      const sessionChatRecord = buildFeishuSessionChatRecord({
        sourceP2pChatId: message.chat_id,
        sourceMessageId: message.message_id,
        sessionChatId: sessionChat.chatId,
        creatorOpenId,
        prompt: request.prompt,
      });
      rememberFeishuSessionChat(sessionChatRecord);

      try {
        await persistFeishuSessionChats(config.stateFile);
      } catch (error) {
        console.warn('[feishu] failed to persist session chat index:', error);
      }

      try {
        await client.sendPrivateChatIndexMessage({
          chatId: message.chat_id,
          text: buildPrivateChatIndexText({
            sessionChatName: sessionChat.name ?? sessionChatName,
            sessionChatId: sessionChat.chatId,
            promptPreview: sessionChatRecord.promptPreview,
            createdAt: sessionChatRecord.createdAt,
          }),
        });
      } catch (error) {
        console.warn('[feishu] failed to send private-chat index message:', error);
      }

      try {
        await client.sendMessage({
          receiveId: sessionChat.chatId,
          receiveIdType: 'chat_id',
          msgType: 'text',
          content: JSON.stringify({ text: request.prompt }),
        });
      } catch (error) {
        await transport.sendText(
          target,
          `Session chat created, but the initial prompt could not be posted: ${describeError(error)}`,
        );
        return;
      }

      const result = await runFeishuConversation({
        conversationId: sessionChat.chatId,
        target: {
          chatId: sessionChat.chatId,
        },
        prompt: request.prompt,
        mode: request.mode,
        transport,
        defaultCwd: config.claudeCwd,
        sourceMessageId: message.message_id,
        attachments: drainPendingFeishuAttachments(message.chat_id),
        persistState,
      });

      if (result.kind === 'busy') {
        await transport.sendText({ chatId: sessionChat.chatId }, 'Conversation is already running.');
      }
      return;
    }

    const result = await runFeishuConversation({
      conversationId,
      target,
      prompt: request.prompt,
      mode: request.mode,
      transport,
      defaultCwd: config.claudeCwd,
      sourceMessageId: message.message_id,
      persistState,
    });

    if (result.kind === 'busy') {
      await transport.sendText(target, 'Conversation is already running.');
    }
  }

  async function handleCardActionEvent(payload: FeishuCardActionTriggerEvent): Promise<void> {
    await ensureInitialized();
    const rawEvent = normalizeFeishuCardActionTriggerEvent(payload);
    const event = normalizeFeishuEvent(rawEvent);
    const action = rawEvent.action?.value as FeishuActionPayload['value'] | undefined;
    const conversationId = resolveConversationIdFromAction(event);
    if (!action || !conversationId || typeof action.chatId !== 'string') {
      return;
    }

    const target = {
      chatId: action.chatId,
      replyToMessageId: typeof action.replyToMessageId === 'string' ? action.replyToMessageId : undefined,
    };
    const actionType = action.action;
    if (typeof actionType !== 'string') {
      return;
    }

    if (actionType === 'control-panel') {
      await openFeishuSessionControlPanel({
        conversationId,
        target,
        transport,
      });
      return;
    }

    const result = await handleFeishuControlAction({
      action: actionType === 'backend'
        ? { conversationId, type: 'backend', value: action.value as 'claude' | 'codex' }
        : actionType === 'confirm-backend'
          ? { conversationId, type: 'confirm-backend', value: action.value as 'claude' | 'codex' }
          : actionType === 'cancel-backend'
            ? { conversationId, type: 'cancel-backend' }
            : actionType === 'model'
              ? { conversationId, type: 'model', value: String(action.value) }
              : actionType === 'effort'
                ? { conversationId, type: 'effort', value: String(action.value) }
                : actionType === 'done'
                  ? { conversationId, type: 'done' }
                  : { conversationId, type: 'interrupt' },
      target,
      transport,
      persist: persistState,
    });

    if (result.kind === 'backend-confirmation') {
      await transport.sendCard(
        target,
        buildFeishuBackendConfirmationCardPayload(
          result.card,
          buildFeishuCardContext(conversationId, target),
        ),
      );
      return;
    }

    if (actionType === 'backend' || actionType === 'confirm-backend') {
      const resumed = await resumePendingFeishuRun({
        conversationId,
        transport,
        defaultCwd: config.claudeCwd,
        persistState,
        fallback: typeof action.prompt === 'string' && action.prompt.trim()
          ? {
            target,
            prompt: action.prompt.trim(),
            mode: action.mode === 'ask' ? 'ask' : 'code',
            sourceMessageId: target.replyToMessageId,
          }
          : undefined,
      });

      if (resumed.kind === 'busy') {
        await transport.sendText(target, 'Conversation is already running.');
      }
    }
  }

  async function handleMenuActionEvent(payload: FeishuMenuActionTriggerEvent): Promise<void> {
    await ensureInitialized();
    const rawEvent = normalizeFeishuMenuActionTriggerEvent(payload);
    const event = normalizeFeishuEvent(rawEvent);
    const action = rawEvent.action?.value as FeishuActionPayload['value'] | undefined;
    const conversationId = resolveConversationIdFromAction(event);
    if (
      event.kind !== 'action'
      || event.source !== 'menu'
      || event.action !== 'open-session-controls'
      || !action
      || !conversationId
      || typeof action.chatId !== 'string'
    ) {
      return;
    }

    await openFeishuSessionControlPanel({
      conversationId,
      target: {
        chatId: action.chatId,
      },
      transport,
      requireKnownSessionChat: true,
    });
  }

  return {
    handleMessageEvent,
    handleCardActionEvent,
    handleMenuActionEvent,
  };
}

export function buildFeishuLongConnectionEventHandlers(router: {
  handleMessageEvent(payload: FeishuMessageReceiveEvent): Promise<void>;
  handleCardActionEvent(payload: FeishuCardActionTriggerEvent): Promise<void>;
  handleMenuActionEvent(payload: FeishuMenuActionTriggerEvent): Promise<void>;
}) {
  return {
    [FEISHU_MESSAGE_EVENT_TYPE]: async (payload: FeishuMessageReceiveEvent) => router.handleMessageEvent(payload),
    [FEISHU_CARD_ACTION_EVENT_TYPE]: async (payload: FeishuCardActionTriggerEvent) => router.handleCardActionEvent(payload),
    [FEISHU_MENU_ACTION_EVENT_TYPE]: async (payload: FeishuMenuActionTriggerEvent) => router.handleMenuActionEvent(payload),
  };
}
