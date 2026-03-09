import { describe, expect, it } from 'vitest';

import {
  extractFeishuAttachmentInfos,
  extractFeishuMessageText,
  normalizeFeishuEvent,
  resolveConversationId,
  resolveConversationIdFromAction,
  shouldProcessFeishuMessage,
} from '../index.js';

describe('resolveConversationId', () => {
  it('maps private launcher chats to chat_id for launcher bookkeeping', () => {
    expect(resolveConversationId(normalizeFeishuEvent({
      header: { event_type: 'im.message.receive_v1' },
      event: {
        message: {
          chat_id: 'chat-private',
          chat_type: 'p2p',
          message_id: 'message-1',
        },
      },
    }))).toBe('chat-private');
  });

  it('maps group replies to chat_id so session groups own the conversation id', () => {
    expect(resolveConversationId(normalizeFeishuEvent({
      header: { event_type: 'im.message.receive_v1' },
      event: {
        message: {
          chat_id: 'chat-group',
          chat_type: 'group',
          message_id: 'message-2',
          root_message_id: 'root-1',
        },
      },
    }))).toBe('chat-group');
  });

  it('maps group non-replies to chat_id', () => {
    expect(resolveConversationId(normalizeFeishuEvent({
      header: { event_type: 'im.message.receive_v1' },
      event: {
        message: {
          chat_id: 'chat-group',
          chat_type: 'group',
          message_id: 'message-3',
        },
      },
    }))).toBe('chat-group');
  });

  it('keeps follow-up group replies on the same chat-scoped conversation id', () => {
    const firstReply = resolveConversationId(normalizeFeishuEvent({
      header: { event_type: 'im.message.receive_v1' },
      event: {
        message: {
          chat_id: 'chat-group',
          chat_type: 'group',
          message_id: 'message-4',
          root_message_id: 'root-sticky',
        },
      },
    }));
    const secondReply = resolveConversationId(normalizeFeishuEvent({
      header: { event_type: 'im.message.receive_v1' },
      event: {
        message: {
          chat_id: 'chat-group',
          chat_type: 'group',
          message_id: 'message-5',
          root_message_id: 'root-sticky',
        },
      },
    }));

    expect(firstReply).toBe('chat-group');
    expect(secondReply).toBe('chat-group');
  });
});

describe('resolveConversationIdFromAction', () => {
  it('restores conversationId from card action metadata', () => {
    expect(resolveConversationIdFromAction(normalizeFeishuEvent({
      header: { event_type: 'im.message.action.trigger' },
      action: {
        value: {
          conversationId: 'conversation-from-card',
        },
      },
    }))).toBe('conversation-from-card');
  });
});

describe('Feishu rich message parsing', () => {
  it('extracts readable prompt text from post messages', () => {
    expect(extractFeishuMessageText({
      chat_id: 'chat-1',
      chat_type: 'group',
      message_id: 'message-post-1',
      message_type: 'post',
      content: JSON.stringify({
        zh_cn: {
          title: '看图任务',
          content: [[
            { tag: 'at', user_id: 'bot-open-id', user_name: 'relay-bot' },
            { tag: 'text', text: ' 帮我总结这张图 ' },
            { tag: 'img', image_key: 'image-key-1' },
          ]],
        },
      }),
    })).toBe('看图任务 帮我总结这张图');
  });

  it('treats post mentions as actionable group messages and extracts inline images', () => {
    const message = {
      chat_id: 'chat-1',
      chat_type: 'group',
      message_id: 'message-post-2',
      message_type: 'post',
      content: JSON.stringify({
        zh_cn: {
          title: '',
          content: [[
            { tag: 'at', user_id: 'bot-open-id', user_name: 'relay-bot' },
            { tag: 'text', text: ' 看一下 ' },
            { tag: 'img', image_key: 'image-key-1' },
            { tag: 'img', image_key: 'image-key-2' },
          ]],
        },
      }),
    } as const;

    expect(shouldProcessFeishuMessage(message)).toBe(true);
    expect(extractFeishuAttachmentInfos(message)).toEqual([
      {
        fileKey: 'image-key-1',
        fileName: 'image',
        resourceType: 'image',
      },
      {
        fileKey: 'image-key-2',
        fileName: 'image',
        resourceType: 'image',
      },
    ]);
  });
});
