import { readFile } from 'node:fs/promises';
import { initState, persistState } from '@agent-im-relay/core';
import type { FeishuConfig } from './config.js';
import { createFeishuClient } from './api.js';
import { buildFeishuBackendConfirmationCardPayload } from './cards.js';
import {
  extractFeishuFileInfo,
  extractFeishuMessageText,
  normalizeFeishuEvent,
  resolveConversationId,
  resolveConversationIdFromAction,
  shouldProcessFeishuMessage,
  type FeishuActionPayload,
  type FeishuMessagePayload,
} from './conversation.js';
import {
  handleFeishuCallback,
  unwrapFeishuCallbackBody,
} from './security.js';
import {
  buildFeishuCardContext,
  handleFeishuControlAction,
  queuePendingFeishuAttachments,
  resolveFeishuMessageRequest,
  runFeishuConversation,
  type FeishuRuntimeTransport,
  type FeishuTarget,
} from './runtime.js';

type FeishuClient = ReturnType<typeof createFeishuClient>;

export type FeishuCallbackResponse = {
  status: number;
  headers?: Record<string, string>;
  body: string;
};

type HandlerDependencies = {
  client?: FeishuClient;
};

function json(body: unknown, status = 200): FeishuCallbackResponse {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  };
}

function text(body: string, status = 200): FeishuCallbackResponse {
  return {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
    body,
  };
}

function createTransport(client: FeishuClient): FeishuRuntimeTransport {
  async function sendText(target: FeishuTarget, content: string): Promise<void> {
    if (target.replyToMessageId) {
      await client.replyMessage({
        messageId: target.replyToMessageId,
        msgType: 'text',
        content: JSON.stringify({ text: content }),
      });
      return;
    }

    await client.sendMessage({
      receiveId: target.chatId,
      msgType: 'text',
      content: JSON.stringify({ text: content }),
    });
  }

  return {
    sendText,
    async sendCard(target, card): Promise<void> {
      if (target.replyToMessageId) {
        await client.replyMessage({
          messageId: target.replyToMessageId,
          msgType: 'interactive',
          content: JSON.stringify(card),
        });
        return;
      }

      await client.sendCard(target.chatId, card);
    },
    async uploadFile(target, filePath): Promise<void> {
      const buffer = await readFile(filePath);
      const fileKey = await client.uploadFileContent({
        fileName: filePath.split('/').pop() ?? 'artifact',
        data: buffer,
      });

      if (target.replyToMessageId) {
        await client.replyMessage({
          messageId: target.replyToMessageId,
          msgType: 'file',
          content: JSON.stringify({ file_key: fileKey }),
        });
        return;
      }

      await client.sendFileMessage(target.chatId, fileKey);
    },
  };
}

function isUrlVerification(body: string): { challenge: string; token?: string } | null {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (parsed.type !== 'url_verification' || typeof parsed.challenge !== 'string') {
      return null;
    }
    return {
      challenge: parsed.challenge,
      token: typeof parsed.token === 'string' ? parsed.token : undefined,
    };
  } catch {
    return null;
  }
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

export function createFeishuCallbackHandler(
  config: FeishuConfig,
  dependencies: HandlerDependencies = {},
): (request: {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body?: string;
}) => Promise<FeishuCallbackResponse> {
  const client = dependencies.client ?? createFeishuClient(config);
  const transport = createTransport(client);
  let initialized = false;

  async function ensureInitialized(): Promise<void> {
    if (initialized) {
      return;
    }

    await initState();
    initialized = true;
  }

  return async ({ method, url, headers, body = '' }) => {
    if (method === 'GET' && url === '/healthz') {
      return text('ok');
    }

    if (method !== 'POST' || url !== '/feishu/callback') {
      return text('not found', 404);
    }

    const callbackBody = unwrapFeishuCallbackBody({
      body,
      encryptKey: config.feishuEncryptKey,
    });

    const verification = isUrlVerification(callbackBody);
    if (verification) {
      if (config.feishuVerificationToken && verification.token !== config.feishuVerificationToken) {
        return json({ code: 403, msg: 'invalid verification token' }, 403);
      }

      return json({ challenge: verification.challenge });
    }

    await handleFeishuCallback({
      body,
      payloadBody: callbackBody,
      headers,
      signingSecret: config.feishuAppSecret,
      runEvent: async (payload) => {
        await ensureInitialized();
        const event = normalizeFeishuEvent(payload as Parameters<typeof normalizeFeishuEvent>[0]);

        if (event.kind === 'message') {
          const message = (payload.event as { message?: FeishuMessagePayload } | undefined)?.message;
          if (!message) {
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

          if (!shouldProcessFeishuMessage(message)) {
            return;
          }

          const request = resolveFeishuMessageRequest(extractFeishuMessageText(message));
          if (!request.prompt) {
            await transport.sendText(target, 'Please include a prompt after mentioning the bot.');
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
          });

          if (result.kind === 'busy') {
            await transport.sendText(target, 'Conversation is already running.');
          }
          return;
        }

        const action = (payload.action as FeishuActionPayload | undefined)?.value;
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
        }
      },
    });

    return json({ code: 0 });
  };
}
