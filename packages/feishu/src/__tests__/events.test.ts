import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';

const coreMocks = vi.hoisted(() => ({
  initState: vi.fn(async () => undefined),
  persistState: vi.fn(async () => undefined),
}));

const runtimeMocks = vi.hoisted(() => ({
  handleFeishuControlAction: vi.fn(),
  resumePendingFeishuRun: vi.fn(),
  runFeishuConversation: vi.fn(),
  queuePendingFeishuAttachments: vi.fn(),
}));

vi.mock('@agent-im-relay/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agent-im-relay/core')>();
  return {
    ...actual,
    initState: coreMocks.initState,
    persistState: coreMocks.persistState,
  };
});

vi.mock('../runtime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime.js')>();
  return {
    ...actual,
    handleFeishuControlAction: runtimeMocks.handleFeishuControlAction,
    queuePendingFeishuAttachments: runtimeMocks.queuePendingFeishuAttachments,
    resumePendingFeishuRun: runtimeMocks.resumePendingFeishuRun,
    runFeishuConversation: runtimeMocks.runFeishuConversation,
  };
});

import {
  buildFeishuLongConnectionEventHandlers,
  createFeishuEventRouter,
  FEISHU_CARD_ACTION_EVENT_TYPE,
  FEISHU_MENU_ACTION_EVENT_TYPE,
  FEISHU_MESSAGE_EVENT_TYPE,
  normalizeFeishuCardActionTriggerEvent,
  normalizeFeishuMenuActionTriggerEvent,
  normalizeFeishuMessageReceiveEvent,
} from '../events.js';
import { normalizeFeishuEvent } from '../conversation.js';
import { resolveFeishuSessionChatStateFile } from '../config.js';
import {
  buildFeishuSessionChatRecord,
  persistFeishuSessionChats,
  rememberFeishuSessionChat,
  resetFeishuSessionChatsForTests,
} from '../session-chat.js';

const baseConfig = {
  agentTimeoutMs: 1_000,
  claudeCwd: process.cwd(),
  stateFile: '/tmp/feishu-events-state.json',
  artifactsBaseDir: '/tmp/feishu-events-artifacts',
  artifactRetentionDays: 14,
  artifactMaxSizeBytes: 8 * 1024 * 1024,
  claudeBin: 'claude',
  codexBin: 'codex',
  feishuAppId: 'test-app-id',
  feishuAppSecret: 'test-secret',
  feishuBaseUrl: 'https://open.feishu.cn',
} as const;

afterEach(async () => {
  coreMocks.initState.mockClear();
  coreMocks.persistState.mockClear();
  runtimeMocks.handleFeishuControlAction.mockReset();
  runtimeMocks.queuePendingFeishuAttachments.mockReset();
  runtimeMocks.resumePendingFeishuRun.mockReset();
  runtimeMocks.runFeishuConversation.mockReset();
  resetFeishuSessionChatsForTests();
  await rm(resolveFeishuSessionChatStateFile(baseConfig.stateFile), { force: true });
});

describe('Feishu long-connection events', () => {
  it('normalizes message events into the local runtime shape', () => {
    expect(normalizeFeishuMessageReceiveEvent({
      message: {
        message_id: 'message-1',
        root_id: 'root-1',
        chat_id: 'chat-1',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: '@_user_1 ship it' }),
      },
    })).toEqual({
      event: {
        message: {
          message_id: 'message-1',
          root_message_id: 'root-1',
          chat_id: 'chat-1',
          chat_type: 'group',
          message_type: 'text',
          content: JSON.stringify({ text: '@_user_1 ship it' }),
          mentions: undefined,
        },
      },
    });
  });

  it('normalizes card-action events into the local runtime shape', () => {
    expect(normalizeFeishuCardActionTriggerEvent({
      open_message_id: 'open-message-1',
      action: {
        value: {
          conversationId: 'conv-1',
          chatId: 'chat-1',
          action: 'interrupt',
        },
      },
    })).toEqual({
      action: {
        value: {
          conversationId: 'conv-1',
          chatId: 'chat-1',
          action: 'interrupt',
          replyToMessageId: 'open-message-1',
        },
      },
    });
  });

  it('normalizes menu-trigger events into the local control-open shape', () => {
    expect(normalizeFeishuEvent(normalizeFeishuMenuActionTriggerEvent({
      event_key: 'open-session-controls',
      chat_id: 'session-chat-1',
    }))).toEqual({
      kind: 'action',
      source: 'menu',
      conversationId: 'session-chat-1',
      chatId: 'session-chat-1',
      action: 'open-session-controls',
    });
  });

  it('routes message events into the Feishu runtime conversation runner', async () => {
    runtimeMocks.runFeishuConversation.mockResolvedValue({ kind: 'started' });
    const router = createFeishuEventRouter(baseConfig, {
      client: {
        replyMessage: vi.fn(async () => undefined),
        sendMessage: vi.fn(async () => undefined),
        sendCard: vi.fn(async () => undefined),
        uploadFileContent: vi.fn(async () => 'file-key'),
        sendFileMessage: vi.fn(async () => undefined),
        downloadMessageResource: vi.fn(async () => new Response()),
      } as never,
    });

    await router.handleMessageEvent({
      message: {
        message_id: 'message-1',
        chat_id: 'chat-1',
        chat_type: 'group',
        message_type: 'text',
        mentions: [{ id: { open_id: 'bot-open-id' }, name: 'relay-bot' }],
        content: JSON.stringify({ text: '@_user_1 hello bot' }),
      },
    });

    expect(coreMocks.initState).toHaveBeenCalledOnce();
    expect(runtimeMocks.runFeishuConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'chat-1',
      prompt: 'hello bot',
      mode: 'code',
    }));
  });

  it('creates a session group for private-chat launches and starts the first run there', async () => {
    runtimeMocks.runFeishuConversation.mockResolvedValue({ kind: 'started' });
    const createSessionChat = vi.fn(async () => ({
      chatId: 'session-chat-1',
      name: 'Session · hello bot · ge-1',
    }));
    const sendPrivateChatIndexMessage = vi.fn(async () => 'message-index-1');
    const sendMessage = vi.fn(async () => 'message-session-prompt-1');
    const router = createFeishuEventRouter(baseConfig, {
      client: {
        createSessionChat,
        sendPrivateChatIndexMessage,
        replyMessage: vi.fn(async () => undefined),
        sendMessage,
        sendCard: vi.fn(async () => undefined),
        uploadFileContent: vi.fn(async () => 'file-key'),
        sendFileMessage: vi.fn(async () => undefined),
        downloadMessageResource: vi.fn(async () => new Response()),
      } as never,
    });

    await router.handleMessageEvent({
      sender: {
        sender_id: {
          open_id: 'ou_user_1',
        },
      },
      message: {
        message_id: 'message-1',
        chat_id: 'p2p-chat-1',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: 'hello bot' }),
      },
    });

    expect(createSessionChat).toHaveBeenCalledWith(expect.objectContaining({
      userOpenId: 'ou_user_1',
      name: expect.stringContaining('hello bot'),
    }));
    expect(sendPrivateChatIndexMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'p2p-chat-1',
      text: expect.stringContaining('session-chat-1'),
    }));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      receiveId: 'session-chat-1',
      msgType: 'text',
      content: JSON.stringify({ text: 'hello bot' }),
    }));
    expect(runtimeMocks.runFeishuConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'session-chat-1',
      target: {
        chatId: 'session-chat-1',
      },
      prompt: 'hello bot',
      mode: 'code',
    }));
  });

  it('does not create a second session group when the same private-chat message is delivered twice', async () => {
    runtimeMocks.runFeishuConversation.mockResolvedValue({ kind: 'started' });
    const createSessionChat = vi.fn(async () => ({
      chatId: 'session-chat-1',
      name: 'Session · hello bot · ge-1',
    }));
    const sendPrivateChatIndexMessage = vi.fn(async () => 'message-index-1');
    const sendMessage = vi.fn(async () => 'message-session-prompt-1');
    const router = createFeishuEventRouter(baseConfig, {
      client: {
        createSessionChat,
        sendPrivateChatIndexMessage,
        replyMessage: vi.fn(async () => undefined),
        sendMessage,
        sendCard: vi.fn(async () => undefined),
        uploadFileContent: vi.fn(async () => 'file-key'),
        sendFileMessage: vi.fn(async () => undefined),
        downloadMessageResource: vi.fn(async () => new Response()),
      } as never,
    });

    const payload = {
      sender: {
        sender_id: {
          open_id: 'ou_user_1',
        },
      },
      message: {
        message_id: 'message-1',
        chat_id: 'p2p-chat-1',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: 'hello bot' }),
      },
    } as const;

    await router.handleMessageEvent(payload);
    await router.handleMessageEvent(payload);

    expect(createSessionChat).toHaveBeenCalledOnce();
    expect(sendPrivateChatIndexMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(runtimeMocks.runFeishuConversation).toHaveBeenCalledOnce();
  });

  it('routes plain follow-up messages inside a known session chat without requiring a mention', async () => {
    runtimeMocks.runFeishuConversation.mockResolvedValue({ kind: 'started' });
    const tempDir = await mkdtemp(path.join(tmpdir(), 'feishu-events-session-chat-'));
    const stateFile = path.join(tempDir, 'sessions.json');

    rememberFeishuSessionChat(buildFeishuSessionChatRecord({
      sourceP2pChatId: 'p2p-chat-1',
      sourceMessageId: 'message-1',
      sessionChatId: 'session-chat-1',
      creatorOpenId: 'ou_user_1',
      createdAt: '2026-03-08T10:00:00.000Z',
      prompt: 'hello bot',
    }));
    await persistFeishuSessionChats(stateFile);
    resetFeishuSessionChatsForTests();

    const router = createFeishuEventRouter({
      ...baseConfig,
      stateFile,
    }, {
      client: {
        replyMessage: vi.fn(async () => undefined),
        sendMessage: vi.fn(async () => undefined),
        sendCard: vi.fn(async () => undefined),
        uploadFileContent: vi.fn(async () => 'file-key'),
        sendFileMessage: vi.fn(async () => undefined),
        downloadMessageResource: vi.fn(async () => new Response()),
      } as never,
    });

    await router.handleMessageEvent({
      message: {
        message_id: 'message-2',
        chat_id: 'session-chat-1',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: 'follow up without mention' }),
      },
    });

    expect(runtimeMocks.runFeishuConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'session-chat-1',
      prompt: 'follow up without mention',
      mode: 'code',
    }));

    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns a visible private-chat error when session-group creation fails', async () => {
    const replyMessage = vi.fn(async () => undefined);
    const createSessionChat = vi.fn(async () => {
      throw new Error('permission denied');
    });
    const router = createFeishuEventRouter(baseConfig, {
      client: {
        createSessionChat,
        sendPrivateChatIndexMessage: vi.fn(async () => undefined),
        replyMessage,
        sendMessage: vi.fn(async () => undefined),
        sendCard: vi.fn(async () => undefined),
        uploadFileContent: vi.fn(async () => 'file-key'),
        sendFileMessage: vi.fn(async () => undefined),
        downloadMessageResource: vi.fn(async () => new Response()),
      } as never,
    });

    await router.handleMessageEvent({
      sender: {
        sender_id: {
          open_id: 'ou_user_1',
        },
      },
      message: {
        message_id: 'message-1',
        chat_id: 'p2p-chat-1',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: 'hello bot' }),
      },
    });

    expect(replyMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'message-1',
      msgType: 'text',
      content: JSON.stringify({ text: 'Could not create session chat: permission denied' }),
    }));
    expect(runtimeMocks.runFeishuConversation).not.toHaveBeenCalled();
  });

  it('continues the session-group flow when the private-chat index message fails', async () => {
    runtimeMocks.runFeishuConversation.mockResolvedValue({ kind: 'started' });
    const createSessionChat = vi.fn(async () => ({
      chatId: 'session-chat-1',
      name: 'Session · hello bot · ge-1',
    }));
    const sendPrivateChatIndexMessage = vi.fn(async () => {
      throw new Error('message send failed');
    });
    const sendMessage = vi.fn(async () => 'message-session-prompt-1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const router = createFeishuEventRouter(baseConfig, {
      client: {
        createSessionChat,
        sendPrivateChatIndexMessage,
        replyMessage: vi.fn(async () => undefined),
        sendMessage,
        sendCard: vi.fn(async () => undefined),
        uploadFileContent: vi.fn(async () => 'file-key'),
        sendFileMessage: vi.fn(async () => undefined),
        downloadMessageResource: vi.fn(async () => new Response()),
      } as never,
    });

    await router.handleMessageEvent({
      sender: {
        sender_id: {
          open_id: 'ou_user_1',
        },
      },
      message: {
        message_id: 'message-1',
        chat_id: 'p2p-chat-1',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: 'hello bot' }),
      },
    });

    expect(warn).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      receiveId: 'session-chat-1',
      msgType: 'text',
    }));
    expect(runtimeMocks.runFeishuConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'session-chat-1',
    }));

    warn.mockRestore();
  });

  it('queues file attachments from message events and acknowledges them', async () => {
    const replyMessage = vi.fn(async () => undefined);
    const router = createFeishuEventRouter(baseConfig, {
      client: {
        replyMessage,
        sendMessage: vi.fn(async () => undefined),
        sendCard: vi.fn(async () => undefined),
        uploadFileContent: vi.fn(async () => 'file-key'),
        sendFileMessage: vi.fn(async () => undefined),
        downloadMessageResource: vi.fn(async () => new Response(Buffer.from('hello'), {
          headers: {
            'content-type': 'text/plain',
          },
        })),
      } as never,
    });

    await router.handleMessageEvent({
      message: {
        message_id: 'message-file-1',
        chat_id: 'chat-1',
        chat_type: 'p2p',
        message_type: 'file',
        content: JSON.stringify({
          file_key: 'file-key-1',
          file_name: 'spec.txt',
        }),
      },
    });

    expect(runtimeMocks.queuePendingFeishuAttachments).toHaveBeenCalledWith(
      'chat-1',
      [expect.objectContaining({
        fileKey: 'file-key-1',
        name: 'spec.txt',
      })],
    );
    expect(replyMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'message-file-1',
      msgType: 'text',
    }));
  });

  it('falls back to chat send when replyMessage returns HTTP 400', async () => {
    const replyMessage = vi.fn(async () => {
      throw new Error('Feishu reply message failed with HTTP 400.');
    });
    const sendMessage = vi.fn(async () => undefined);
    const router = createFeishuEventRouter(baseConfig, {
      client: {
        replyMessage,
        sendMessage,
        sendCard: vi.fn(async () => undefined),
        uploadFileContent: vi.fn(async () => 'file-key'),
        sendFileMessage: vi.fn(async () => undefined),
        downloadMessageResource: vi.fn(async () => new Response()),
      } as never,
    });

    await router.handleMessageEvent({
      message: {
        message_id: 'message-no-prompt',
        chat_id: 'chat-1',
        chat_type: 'group',
        message_type: 'text',
        mentions: [{ id: { open_id: 'bot-open-id' }, name: 'relay-bot' }],
        content: JSON.stringify({ text: '@_user_1 ' }),
      },
    });

    expect(replyMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith({
      receiveId: 'chat-1',
      msgType: 'text',
      content: JSON.stringify({ text: 'Please include a prompt after mentioning the bot.' }),
    });
  });

  it('routes card-action events into the Feishu control handler', async () => {
    runtimeMocks.handleFeishuControlAction.mockResolvedValue({ kind: 'applied' });
    runtimeMocks.resumePendingFeishuRun.mockResolvedValue({ kind: 'none' });

    const router = createFeishuEventRouter(baseConfig, {
      client: {
        replyMessage: vi.fn(async () => undefined),
        sendMessage: vi.fn(async () => undefined),
        sendCard: vi.fn(async () => undefined),
        uploadFileContent: vi.fn(async () => 'file-key'),
        sendFileMessage: vi.fn(async () => undefined),
        downloadMessageResource: vi.fn(async () => new Response()),
      } as never,
    });

    await router.handleCardActionEvent({
      open_message_id: 'open-message-1',
      action: {
        value: {
          conversationId: 'conv-1',
          chatId: 'chat-1',
          action: 'interrupt',
        },
      },
    });

    expect(runtimeMocks.handleFeishuControlAction).toHaveBeenCalledWith(expect.objectContaining({
      action: {
        conversationId: 'conv-1',
        type: 'interrupt',
      },
      target: {
        chatId: 'chat-1',
        replyToMessageId: 'open-message-1',
      },
    }));
  });

  it('opens the expanded control panel when the anchor control action is clicked', async () => {
    runtimeMocks.handleFeishuControlAction.mockResolvedValue({ kind: 'applied' });
    runtimeMocks.resumePendingFeishuRun.mockResolvedValue({ kind: 'none' });
    const sendCard = vi.fn(async () => undefined);

    const router = createFeishuEventRouter(baseConfig, {
      client: {
        replyMessage: vi.fn(async () => undefined),
        sendMessage: vi.fn(async () => undefined),
        sendCard,
        uploadFileContent: vi.fn(async () => 'file-key'),
        sendFileMessage: vi.fn(async () => undefined),
        downloadMessageResource: vi.fn(async () => new Response()),
      } as never,
    });

    await router.handleCardActionEvent({
      action: {
        value: {
          conversationId: 'conv-1',
          chatId: 'chat-1',
          action: 'control-panel',
        },
      },
    });

    expect(runtimeMocks.handleFeishuControlAction).not.toHaveBeenCalled();
    expect(sendCard).toHaveBeenCalledOnce();
    const cardPayload = sendCard.mock.calls[0]?.[1] as Record<string, any>;
    const buttonTexts = cardPayload.body.elements
      .filter((element: Record<string, unknown>) => element.tag === 'button')
      .map((button: Record<string, any>) => button.text.content);
    expect(buttonTexts).toEqual([
      'Done',
      'Claude',
      'Codex',
      'Claude 3.7',
      'GPT-5 Codex',
      'Low',
      'Medium',
      'High',
    ]);
  });

  it('opens the expanded control panel from a menu trigger inside a known session chat', async () => {
    const sendCard = vi.fn(async () => undefined);
    const tempDir = await mkdtemp(path.join(tmpdir(), 'feishu-events-menu-session-chat-'));
    const stateFile = path.join(tempDir, 'sessions.json');
    rememberFeishuSessionChat(buildFeishuSessionChatRecord({
      sourceP2pChatId: 'p2p-chat-1',
      sourceMessageId: 'message-1',
      sessionChatId: 'session-chat-1',
      creatorOpenId: 'ou_user_1',
      prompt: 'hello bot',
    }));
    await persistFeishuSessionChats(stateFile);
    resetFeishuSessionChatsForTests();

    const router = createFeishuEventRouter({
      ...baseConfig,
      stateFile,
    }, {
      client: {
        replyMessage: vi.fn(async () => undefined),
        sendMessage: vi.fn(async () => undefined),
        sendCard,
        uploadFileContent: vi.fn(async () => 'file-key'),
        sendFileMessage: vi.fn(async () => undefined),
        downloadMessageResource: vi.fn(async () => new Response()),
      } as never,
    });

    await router.handleMenuActionEvent({
      event_key: 'open-session-controls',
      chat_id: 'session-chat-1',
    });

    expect(runtimeMocks.handleFeishuControlAction).not.toHaveBeenCalled();
    expect(sendCard).toHaveBeenCalledOnce();
    const cardPayload = sendCard.mock.calls[0]?.[1] as Record<string, any>;
    const buttonTexts = cardPayload.body.elements
      .filter((element: Record<string, unknown>) => element.tag === 'button')
      .map((button: Record<string, any>) => button.text.content);
    expect(buttonTexts).toEqual([
      'Done',
      'Claude',
      'Codex',
      'Claude 3.7',
      'GPT-5 Codex',
      'Low',
      'Medium',
      'High',
    ]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects menu-triggered controls when the current chat is not a known session chat', async () => {
    const sendCard = vi.fn(async () => undefined);
    const router = createFeishuEventRouter(baseConfig, {
      client: {
        replyMessage: vi.fn(async () => undefined),
        sendMessage: vi.fn(async () => undefined),
        sendCard,
        uploadFileContent: vi.fn(async () => 'file-key'),
        sendFileMessage: vi.fn(async () => undefined),
        downloadMessageResource: vi.fn(async () => new Response()),
      } as never,
    });

    await router.handleMenuActionEvent({
      event_key: 'open-session-controls',
      chat_id: 'group-chat-1',
    });

    expect(runtimeMocks.handleFeishuControlAction).not.toHaveBeenCalled();
    expect(sendCard).not.toHaveBeenCalled();
  });

  it('builds long-connection handlers for message and card-action events', async () => {
    const handleMessageEvent = vi.fn(async () => undefined);
    const handleCardActionEvent = vi.fn(async () => undefined);
    const handleMenuActionEvent = vi.fn(async () => undefined);
    const handlers = buildFeishuLongConnectionEventHandlers({
      handleMessageEvent,
      handleCardActionEvent,
      handleMenuActionEvent,
    });

    expect(Object.keys(handlers)).toEqual([
      FEISHU_MESSAGE_EVENT_TYPE,
      FEISHU_CARD_ACTION_EVENT_TYPE,
      FEISHU_MENU_ACTION_EVENT_TYPE,
    ]);

    await handlers[FEISHU_MESSAGE_EVENT_TYPE]({
      message: {
        message_id: 'message-1',
        chat_id: 'chat-1',
      },
    });
    await handlers[FEISHU_CARD_ACTION_EVENT_TYPE]({
      action: {
        value: {
          conversationId: 'conv-1',
          chatId: 'chat-1',
          action: 'interrupt',
        },
      },
    });
    await handlers[FEISHU_MENU_ACTION_EVENT_TYPE]({
      event_key: 'open-session-controls',
      chat_id: 'session-chat-1',
    });

    expect(handleMessageEvent).toHaveBeenCalledOnce();
    expect(handleCardActionEvent).toHaveBeenCalledOnce();
    expect(handleMenuActionEvent).toHaveBeenCalledOnce();
  });
});
