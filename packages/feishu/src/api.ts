import { readFile } from 'node:fs/promises';
import type { FeishuConfig } from './config.js';

export type FeishuReceiveIdType = 'chat_id' | 'open_id' | 'union_id' | 'email' | 'user_id';
export type FeishuMessageType = 'text' | 'interactive' | 'file';
export type FeishuUserIdType = 'open_id' | 'union_id' | 'user_id';

type FetchLike = typeof fetch;

type FeishuClientOptions = {
  fetchImpl?: FetchLike;
  now?: () => number;
};

type CachedToken = {
  value: string;
  expiresAt: number;
};

function buildUrl(baseUrl: string, pathname: string): URL {
  return new URL(pathname, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  return JSON.parse(await response.text()) as T;
}

function assertFeishuSuccess(
  response: Response,
  payload: { code?: number; msg?: string },
  context: string,
): void {
  if (!response.ok) {
    const suffix = payload.msg ? `: ${payload.msg}` : '.';
    throw new Error(`${context} failed with HTTP ${response.status}${suffix}`);
  }

  if (payload.code && payload.code !== 0) {
    throw new Error(`${context} failed: ${payload.msg ?? `code ${payload.code}`}`);
  }
}

export function createFeishuClient(
  config: FeishuConfig,
  options: FeishuClientOptions = {},
): {
  getTenantAccessToken(): Promise<string>;
  createChat(options: {
    name: string;
    userIdList: string[];
    userIdType?: FeishuUserIdType;
    chatMode?: string;
    chatType?: string;
  }): Promise<{
    chatId: string;
    name?: string;
  }>;
  createSessionChat(options: {
    name: string;
    userOpenId: string;
  }): Promise<{
    chatId: string;
    name?: string;
  }>;
  sendMessage(options: {
    receiveId: string;
    msgType: FeishuMessageType;
    content: string;
    receiveIdType?: FeishuReceiveIdType;
  }): Promise<string | undefined>;
  replyMessage(options: {
    messageId: string;
    msgType: FeishuMessageType;
    content: string;
  }): Promise<string | undefined>;
  sendCard(receiveId: string, card: Record<string, unknown>, receiveIdType?: FeishuReceiveIdType): Promise<string | undefined>;
  updateCardMessage(messageId: string, card: Record<string, unknown>): Promise<void>;
  uploadFile(options: { filePath: string; fileName: string }): Promise<string>;
  uploadFileContent(options: { fileName: string; data: Buffer | Uint8Array | ArrayBuffer }): Promise<string>;
  sendFileMessage(receiveId: string, fileKey: string, receiveIdType?: FeishuReceiveIdType): Promise<string | undefined>;
  sendPrivateChatIndexMessage(options: {
    chatId: string;
    text: string;
  }): Promise<string | undefined>;
  downloadMessageResource(messageId: string, fileKey: string): Promise<Response>;
} {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  let cachedToken: CachedToken | null = null;

  if (!fetchImpl) {
    throw new Error('Fetch is not available.');
  }

  async function getTenantAccessToken(): Promise<string> {
    const currentTime = now();
    if (cachedToken && currentTime < cachedToken.expiresAt) {
      return cachedToken.value;
    }

    const response = await fetchImpl(buildUrl(config.feishuBaseUrl, '/open-apis/auth/v3/tenant_access_token/internal').toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        app_id: config.feishuAppId,
        app_secret: config.feishuAppSecret,
      }),
    });
    const payload = await readJsonResponse<{
      code?: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    }>(response);
    assertFeishuSuccess(response, payload, 'Feishu token exchange');

    if (!payload.tenant_access_token) {
      throw new Error('Feishu token exchange did not return tenant_access_token.');
    }

    cachedToken = {
      value: payload.tenant_access_token,
      expiresAt: currentTime + Math.max(((payload.expire ?? 3600) - 60) * 1000, 60_000),
    };
    return cachedToken.value;
  }

  async function authorizedFetch(url: string, init: RequestInit): Promise<Response> {
    const token = await getTenantAccessToken();
    return fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
  }

  async function createChat(options: {
    name: string;
    userIdList: string[];
    userIdType?: FeishuUserIdType;
    chatMode?: string;
    chatType?: string;
  }): Promise<{
    chatId: string;
    name?: string;
  }> {
    const url = buildUrl(config.feishuBaseUrl, '/open-apis/im/v1/chats');
    url.searchParams.set('user_id_type', options.userIdType ?? 'open_id');

    const response = await authorizedFetch(url.toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        name: options.name,
        user_id_list: options.userIdList,
        chat_mode: options.chatMode ?? 'group',
        chat_type: options.chatType ?? 'private',
      }),
    });
    const payload = await readJsonResponse<{
      code?: number;
      msg?: string;
      data?: {
        chat_id?: string;
        name?: string;
      };
    }>(response);
    assertFeishuSuccess(response, payload, 'Feishu create chat');

    if (!payload.data?.chat_id) {
      throw new Error('Feishu create chat did not return chat_id.');
    }

    return {
      chatId: payload.data.chat_id,
      name: payload.data.name,
    };
  }

  async function createSessionChat(options: {
    name: string;
    userOpenId: string;
  }): Promise<{
    chatId: string;
    name?: string;
  }> {
    return createChat({
      name: options.name,
      userIdList: [options.userOpenId],
      userIdType: 'open_id',
      chatMode: 'group',
      chatType: 'private',
    });
  }

  async function sendMessage(options: {
    receiveId: string;
    msgType: FeishuMessageType;
    content: string;
    receiveIdType?: FeishuReceiveIdType;
  }): Promise<string | undefined> {
    const url = buildUrl(config.feishuBaseUrl, '/open-apis/im/v1/messages');
    url.searchParams.set('receive_id_type', options.receiveIdType ?? 'chat_id');

    const response = await authorizedFetch(url.toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        receive_id: options.receiveId,
        msg_type: options.msgType,
        content: options.content,
      }),
    });
    const payload = await readJsonResponse<{
      code?: number;
      msg?: string;
      data?: {
        message_id?: string;
      };
    }>(response);
    assertFeishuSuccess(response, payload, 'Feishu send message');
    return payload.data?.message_id;
  }

  async function replyMessage(options: {
    messageId: string;
    msgType: FeishuMessageType;
    content: string;
  }): Promise<string | undefined> {
    const response = await authorizedFetch(
      buildUrl(config.feishuBaseUrl, `/open-apis/im/v1/messages/${options.messageId}/reply`).toString(),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          msg_type: options.msgType,
          content: options.content,
        }),
      },
    );
    const payload = await readJsonResponse<{
      code?: number;
      msg?: string;
      data?: {
        message_id?: string;
      };
    }>(response);
    assertFeishuSuccess(response, payload, 'Feishu reply message');
    return payload.data?.message_id;
  }

  async function sendCard(receiveId: string, card: Record<string, unknown>, receiveIdType: FeishuReceiveIdType = 'chat_id') {
    return sendMessage({
      receiveId,
      receiveIdType,
      msgType: 'interactive',
      content: JSON.stringify(card),
    });
  }

  async function updateCardMessage(messageId: string, card: Record<string, unknown>): Promise<void> {
    const response = await authorizedFetch(
      buildUrl(config.feishuBaseUrl, `/open-apis/im/v1/messages/${messageId}`).toString(),
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          msg_type: 'interactive',
          content: JSON.stringify(card),
        }),
      },
    );
    const payload = await readJsonResponse<{
      code?: number;
      msg?: string;
    }>(response);
    assertFeishuSuccess(response, payload, 'Feishu update card message');
  }

  async function uploadBinary(options: {
    fileName: string;
    data: Buffer | Uint8Array | ArrayBuffer;
  }): Promise<string> {
    const fileBuffer = Buffer.isBuffer(options.data)
      ? options.data
      : options.data instanceof ArrayBuffer
        ? Buffer.from(options.data)
        : Buffer.from(options.data);
    const formData = new FormData();
    formData.append('file_type', 'stream');
    formData.append('file_name', options.fileName);
    formData.append('file', new Blob([fileBuffer]), options.fileName);

    const response = await authorizedFetch(buildUrl(config.feishuBaseUrl, '/open-apis/im/v1/files').toString(), {
      method: 'POST',
      body: formData,
    });
    const payload = await readJsonResponse<{
      code?: number;
      msg?: string;
      data?: {
        file_key?: string;
      };
    }>(response);
    assertFeishuSuccess(response, payload, 'Feishu upload file');

    if (!payload.data?.file_key) {
      throw new Error('Feishu upload file did not return file_key.');
    }

    return payload.data.file_key;
  }

  async function uploadFile(options: { filePath: string; fileName: string }): Promise<string> {
    return uploadBinary({
      fileName: options.fileName,
      data: await readFile(options.filePath),
    });
  }

  async function sendFileMessage(
    receiveId: string,
    fileKey: string,
    receiveIdType: FeishuReceiveIdType = 'chat_id',
  ): Promise<string | undefined> {
    return sendMessage({
      receiveId,
      receiveIdType,
      msgType: 'file',
      content: JSON.stringify({ file_key: fileKey }),
    });
  }

  async function sendPrivateChatIndexMessage(options: {
    chatId: string;
    text: string;
  }): Promise<string | undefined> {
    return sendMessage({
      receiveId: options.chatId,
      receiveIdType: 'chat_id',
      msgType: 'text',
      content: JSON.stringify({ text: options.text }),
    });
  }

  async function downloadMessageResource(messageId: string, fileKey: string): Promise<Response> {
    const url = buildUrl(config.feishuBaseUrl, `/open-apis/im/v1/messages/${messageId}/resources/${fileKey}`);
    url.searchParams.set('type', 'file');
    return authorizedFetch(url.toString(), {
      method: 'GET',
    });
  }

  return {
    getTenantAccessToken,
    createChat,
    createSessionChat,
    sendMessage,
    replyMessage,
    sendCard,
    updateCardMessage,
    uploadFile,
    uploadFileContent: uploadBinary,
    sendFileMessage,
    sendPrivateChatIndexMessage,
    downloadMessageResource,
  };
}
