import type { AgentMode } from '@agent-im-relay/core';
import { buildFeishuSessionChatRecord, rememberFeishuSessionChat } from './session-chat.js';
import { buildFeishuSessionChatName } from './naming.js';

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
  const sessionChat = await options.client.createSessionChat({
    name: buildFeishuSessionChatName(options.prompt),
    userOpenId: options.creatorOpenId,
  });

  rememberFeishuSessionChat(buildFeishuSessionChatRecord({
    sourceP2pChatId: options.sourceChatId,
    sourceMessageId: options.sourceMessageId,
    sessionChatId: sessionChat.chatId,
    creatorOpenId: options.creatorOpenId,
    prompt: options.prompt,
  }));
  await options.persist?.();

  await options.client.sendSharedChatMessage({
    receiveId: options.sourceChatId,
    chatId: sessionChat.chatId,
  });
  await options.client.sendMessage({
    receiveId: sessionChat.chatId,
    receiveIdType: 'chat_id',
    msgType: 'text',
    content: JSON.stringify({
      text: buildFeishuSessionReferenceText(),
    }),
  });
  const mirroredMessageId = await options.client.sendMessage({
    receiveId: sessionChat.chatId,
    receiveIdType: 'chat_id',
    msgType: 'text',
    content: JSON.stringify({
      text: options.prompt,
    }),
  });

  return {
    sessionChatId: sessionChat.chatId,
    prompt: options.prompt,
    mode: options.mode,
    mirroredMessageId,
  };
}
