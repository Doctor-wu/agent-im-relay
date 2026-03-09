import type { AgentMode } from '@agent-im-relay/core';
import { buildFeishuSessionChatRecord, rememberFeishuSessionChat } from './session-chat.js';
import { buildFeishuSessionChatName } from './naming.js';
import { describeError } from './utils.js';

export type FeishuLauncherClient = {
  createSessionChat(options: {
    name: string;
    userOpenId: string;
  }): Promise<{
    chatId: string;
    name?: string;
  }>;
  sendSharedChatMessage(options: {
    receiveId: string;
    chatId: string;
  }): Promise<string | undefined>;
  sendMessage(options: {
    receiveId: string;
    receiveIdType?: 'chat_id' | 'open_id' | 'union_id' | 'email' | 'user_id';
    msgType: 'text' | 'interactive' | 'file' | 'share_chat';
    content: string;
  }): Promise<string | undefined>;
};

export type FeishuLaunchResult = {
  sessionChatId: string;
  prompt: string;
  mode: AgentMode;
  mirroredMessageId?: string;
};

const FEISHU_SESSION_REFERENCE_TEXT = 'Common commands:\n/interrupt - stop the current run';

export function buildFeishuSessionReferenceText(): string {
  return FEISHU_SESSION_REFERENCE_TEXT;
}

export async function launchFeishuSessionFromPrivateChat(options: {
  client: FeishuLauncherClient;
  sourceChatId: string;
  sourceMessageId: string;
  creatorOpenId: string;
  prompt: string;
  mode: AgentMode;
  persist?: () => Promise<void>;
}): Promise<FeishuLaunchResult> {
  let sessionChat: {
    chatId: string;
    name?: string;
  };
  try {
    sessionChat = await options.client.createSessionChat({
      name: buildFeishuSessionChatName(options.prompt),
      userOpenId: options.creatorOpenId,
    });
  } catch (error) {
    throw new Error(`Could not create session chat: ${describeError(error)}`);
  }

  rememberFeishuSessionChat(buildFeishuSessionChatRecord({
    sourceP2pChatId: options.sourceChatId,
    sourceMessageId: options.sourceMessageId,
    sessionChatId: sessionChat.chatId,
    creatorOpenId: options.creatorOpenId,
    prompt: options.prompt,
  }));
  await options.persist?.();

  try {
    await options.client.sendSharedChatMessage({
      receiveId: options.sourceChatId,
      chatId: sessionChat.chatId,
    });
  } catch (error) {
    throw new Error(`Could not share session chat: ${describeError(error)}`);
  }

  try {
    await options.client.sendMessage({
      receiveId: sessionChat.chatId,
      receiveIdType: 'chat_id',
      msgType: 'text',
      content: JSON.stringify({
        text: buildFeishuSessionReferenceText(),
      }),
    });
  } catch (error) {
    throw new Error(`Could not initialize session chat: ${describeError(error)}`);
  }

  let mirroredMessageId: string | undefined;
  try {
    mirroredMessageId = await options.client.sendMessage({
      receiveId: sessionChat.chatId,
      receiveIdType: 'chat_id',
      msgType: 'text',
      content: JSON.stringify({
        text: options.prompt,
      }),
    });
  } catch (error) {
    throw new Error(`Could not initialize session chat: ${describeError(error)}`);
  }

  return {
    sessionChatId: sessionChat.chatId,
    prompt: options.prompt,
    mode: options.mode,
    mirroredMessageId,
  };
}
