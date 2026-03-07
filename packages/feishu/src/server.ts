import type { FeishuConfig } from './config.js';
import { createFeishuClient } from './api.js';
import { createGatewayBridge } from './gateway-bridge.js';
import { createGatewayStateStore } from './gateway-state.js';
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
} from './security.js';
import {
  resolveFeishuMessageRequest,
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
  bridge?: ReturnType<typeof createGatewayBridge>;
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

function createTransport(client: FeishuClient) {
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
    async sendFile(target, file): Promise<void> {
      const fileKey = await client.uploadFileContent({
        fileName: file.fileName,
        data: Buffer.from(file.data, 'base64'),
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

function parseBridgePayload(body: string): {
  clientId: string;
  token: string;
  limit?: number;
  event?: unknown;
} {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  if (typeof parsed.clientId !== 'string' || typeof parsed.token !== 'string') {
    throw new Error('Malformed managed bridge payload.');
  }

  return {
    clientId: parsed.clientId,
    token: parsed.token,
    limit: typeof parsed.limit === 'number' ? parsed.limit : undefined,
    event: parsed.event,
  };
}

function isManagedClientAuthorized(
  config: FeishuConfig,
  payload: { clientId: string; token: string },
): boolean {
  if (payload.clientId !== config.feishuClientId) {
    return false;
  }
  if (payload.token !== config.feishuClientToken) {
    return false;
  }

  return true;
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
  const bridge = dependencies.bridge ?? createGatewayBridge({
    state: createGatewayStateStore({
      defaultClientId: config.feishuClientId,
    }),
    sink: transport,
  });

  return async ({ method, url, headers, body = '' }) => {
    if (method === 'GET' && url === '/healthz') {
      return text('ok');
    }

    if (method === 'POST' && url === '/feishu/bridge/hello') {
      const payload = parseBridgePayload(body);
      if (!isManagedClientAuthorized(config, payload)) {
        return json({ code: 403, msg: 'invalid managed client credentials' }, 403);
      }

      bridge.registerClient({
        type: 'client.hello',
        clientId: payload.clientId,
        requestId: `${payload.clientId}:hello`,
        timestamp: new Date().toISOString(),
        payload: {
          token: payload.token,
        },
      });
      return json({ code: 0, ok: true });
    }

    if (method === 'POST' && url === '/feishu/bridge/heartbeat') {
      const payload = parseBridgePayload(body);
      if (!isManagedClientAuthorized(config, payload)) {
        return json({ code: 403, msg: 'invalid managed client credentials' }, 403);
      }

      bridge.registerClient({
        type: 'client.heartbeat',
        clientId: payload.clientId,
        requestId: `${payload.clientId}:heartbeat`,
        timestamp: new Date().toISOString(),
        payload: {
          token: payload.token,
        },
      });
      return json({ code: 0, ok: true });
    }

    if (method === 'POST' && url === '/feishu/bridge/pull') {
      const payload = parseBridgePayload(body);
      if (!isManagedClientAuthorized(config, payload)) {
        return json({ code: 403, msg: 'invalid managed client credentials' }, 403);
      }

      return json({
        code: 0,
        commands: bridge.pullCommands(payload.clientId, payload.limit ?? 1),
      });
    }

    if (method === 'POST' && url === '/feishu/bridge/events') {
      const payload = parseBridgePayload(body);
      if (!isManagedClientAuthorized(config, payload)) {
        return json({ code: 403, msg: 'invalid managed client credentials' }, 403);
      }
      if (!payload.event || typeof payload.event !== 'object') {
        return json({ code: 400, msg: 'missing bridge event' }, 400);
      }

      await bridge.consumeClientEvent(payload.event as Parameters<typeof bridge.consumeClientEvent>[0]);
      return json({ code: 0, ok: true });
    }

    if (method !== 'POST' || url !== '/feishu/callback') {
      return text('not found', 404);
    }

    const verification = isUrlVerification(body);
    if (verification) {
      if (config.feishuVerificationToken && verification.token !== config.feishuVerificationToken) {
        return json({ code: 403, msg: 'invalid verification token' }, 403);
      }

      return json({ challenge: verification.challenge });
    }

    if (body.includes('"encrypt"')) {
      return json({ code: 501, msg: 'encrypted callbacks are not implemented' }, 501);
    }

    await handleFeishuCallback({
      body,
      headers,
      signingSecret: config.feishuAppSecret,
      runEvent: async (payload) => {
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
            bridge.queueAttachments(conversationId, [await buildManagedAttachment(client, message.message_id, fileInfo)]);
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

          const result = bridge.dispatchRunCommand({
            conversationId,
            target,
            prompt: request.prompt,
            mode: request.mode,
            sourceMessageId: message.message_id,
          });
          if (result.kind === 'offline') {
            await transport.sendText(
              target,
              'Relay client is offline. Start the local Feishu relay client and try again.',
            );
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

        const result = bridge.dispatchControlCommand({
          conversationId,
          target,
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
        });
        if (result.kind === 'offline') {
          await transport.sendText(
            target,
            'Relay client is offline. Start the local Feishu relay client and try again.',
          );
          return;
        }

        if (actionType === 'backend') {
          const resumed = bridge.dispatchPendingRun(conversationId);
          if (resumed.kind === 'offline') {
            await transport.sendText(
              target,
              'Relay client is offline. Start the local Feishu relay client and try again.',
            );
          }
        }
      },
    });

    return json({ code: 0 });
  };
}
