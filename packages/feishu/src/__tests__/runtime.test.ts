import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const coreMocks = vi.hoisted(() => ({
  applySessionControlCommand: vi.fn(),
  evaluateConversationRunRequest: vi.fn(),
  runPlatformConversation: vi.fn(),
}));

vi.mock('@agent-im-relay/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agent-im-relay/core')>();
  return {
    ...actual,
    applySessionControlCommand: coreMocks.applySessionControlCommand,
    evaluateConversationRunRequest: coreMocks.evaluateConversationRunRequest,
    runPlatformConversation: coreMocks.runPlatformConversation,
  };
});

import {
  conversationBackend,
  conversationMode,
} from '@agent-im-relay/core';
import {
  buildFeishuSessionChatRecord,
  getFeishuSessionChat,
  rememberFeishuSessionChat,
} from '../session-chat.js';
import {
  FEISHU_NON_SESSION_CONTROL_TEXT,
  buildFeishuSessionControlPanelPayload,
} from '../cards.js';
import {
  handleFeishuControlAction,
  isFeishuDoneCommand,
  openFeishuSessionControlPanel,
  resetFeishuRuntimeForTests,
  resumePendingFeishuRun,
  runFeishuConversation,
} from '../runtime.js';

afterEach(() => {
  resetFeishuRuntimeForTests();
});

describe('Feishu runtime', () => {
  beforeEach(() => {
    conversationMode.clear();
    coreMocks.applySessionControlCommand.mockReset();
    coreMocks.evaluateConversationRunRequest.mockReset();
    coreMocks.runPlatformConversation.mockReset();

    coreMocks.evaluateConversationRunRequest.mockReturnValue({
      kind: 'ready',
      conversationId: 'conv-1',
      backend: 'claude',
    });
    coreMocks.runPlatformConversation.mockResolvedValue(true);
  });

  it('publishes the session anchor card before starting the platform run', async () => {
    rememberFeishuSessionChat(buildFeishuSessionChatRecord({
      sourceP2pChatId: 'p2p-chat-1',
      sourceMessageId: 'message-1',
      sessionChatId: 'conv-1',
      creatorOpenId: 'ou_user_1',
      createdAt: '2026-03-08T10:00:00.000Z',
      prompt: 'ship it',
    }));
    const transport = {
      sendText: vi.fn(async () => undefined),
      sendCard: vi.fn(async () => 'anchor-message-1'),
      updateCard: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => undefined),
    };
    const persistState = vi.fn(async () => undefined);

    const result = await runFeishuConversation({
      conversationId: 'conv-1',
      target: {
        chatId: 'chat-1',
        replyToMessageId: 'message-1',
      },
      prompt: 'ship it',
      mode: 'code',
      transport,
      defaultCwd: process.cwd(),
      persistState,
    });

    expect(result).toEqual({ kind: 'started' });
    expect(transport.sendText).toHaveBeenCalledWith({
      chatId: 'chat-1',
      replyToMessageId: 'message-1',
    }, 'Starting run…');
    expect(transport.sendCard.mock.invocationCallOrder[0]).toBeLessThan(
      coreMocks.runPlatformConversation.mock.invocationCallOrder[0]!,
    );
    const cardPayload = transport.sendCard.mock.calls[0]?.[1] as Record<string, any>;
    const markdownTexts = cardPayload.body.elements
      .filter((element: Record<string, unknown>) => element.tag === 'markdown')
      .map((element: Record<string, any>) => element.content);
    const buttonTexts = cardPayload.body.elements
      .filter((element: Record<string, unknown>) => element.tag === 'button')
      .map((button: Record<string, any>) => button.text.content);
    expect(markdownTexts).toContain('Use the bot menu for session controls. This card is a fallback if the menu is unavailable.');
    expect(buttonTexts).toEqual(['Fallback Controls', 'Interrupt']);
    expect(getFeishuSessionChat('conv-1')).toEqual(expect.objectContaining({
      anchorMessageId: 'anchor-message-1',
      lastRunStatus: 'idle',
    }));
    expect(transport.updateCard).toHaveBeenCalledOnce();
    expect(persistState).toHaveBeenCalledTimes(2);
  });

  it('does not send environment summary on sticky-session resumes', async () => {
    coreMocks.runPlatformConversation.mockImplementationOnce(async (options) => {
      await options.render(
        {
          target: options.target,
          showEnvironment: false,
        },
        (async function* () {
          yield {
            type: 'environment',
            environment: {
              backend: 'claude',
              mode: 'code',
              model: {},
              cwd: { value: '/tmp/project', source: 'explicit' },
              git: { isRepo: false },
            },
          } as const;
          yield { type: 'done', result: 'continued reply' } as const;
        })(),
      );
      return true;
    });

    const transport = {
      sendText: vi.fn(async () => undefined),
      sendCard: vi.fn(async () => undefined),
      updateCard: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => undefined),
    };

    await runFeishuConversation({
      conversationId: 'conv-resume',
      target: {
        chatId: 'chat-1',
        replyToMessageId: 'message-1',
      },
      prompt: 'continue',
      mode: 'code',
      transport,
      defaultCwd: process.cwd(),
    });

    expect(transport.sendText).not.toHaveBeenCalledWith(
      {
        chatId: 'chat-1',
        replyToMessageId: 'message-1',
      },
      'Environment: backend=claude, mode=code, cwd=/tmp/project',
    );
    expect(transport.sendText).toHaveBeenCalledWith({
      chatId: 'chat-1',
      replyToMessageId: 'message-1',
    }, 'continued reply');
  });

  it('stores blocked runs and resumes them after backend selection', async () => {
    coreMocks.evaluateConversationRunRequest
      .mockReturnValueOnce({
        kind: 'setup-required',
        conversationId: 'conv-gated',
        reason: 'backend-selection',
      })
      .mockReturnValueOnce({
        kind: 'ready',
        conversationId: 'conv-gated',
        backend: 'claude',
      });

    const transport = {
      sendText: vi.fn(async () => undefined),
      sendCard: vi.fn(async () => undefined),
      updateCard: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => undefined),
    };
    const attachments = [
      {
        name: 'spec.md',
        url: 'https://example.com/spec.md',
        contentType: 'text/markdown',
      },
    ];

    await expect(runFeishuConversation({
      conversationId: 'conv-gated',
      target: {
        chatId: 'chat-1',
        replyToMessageId: 'message-1',
      },
      prompt: 'ship it',
      mode: 'code',
      transport,
      defaultCwd: process.cwd(),
      attachments,
    })).resolves.toEqual({ kind: 'blocked' });

    expect(coreMocks.runPlatformConversation).not.toHaveBeenCalled();

    await expect(resumePendingFeishuRun({
      conversationId: 'conv-gated',
      transport,
      defaultCwd: process.cwd(),
    })).resolves.toEqual({ kind: 'started' });

    expect(coreMocks.runPlatformConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-gated',
      prompt: 'ship it',
      attachments,
      backend: 'claude',
    }));
  });

  it('does not send another anchor card when the session chat already has one', async () => {
    rememberFeishuSessionChat({
      ...buildFeishuSessionChatRecord({
        sourceP2pChatId: 'p2p-chat-1',
        sourceMessageId: 'message-1',
        sessionChatId: 'session-chat-1',
        creatorOpenId: 'ou_user_1',
        createdAt: '2026-03-08T10:00:00.000Z',
        prompt: 'follow up',
      }),
      anchorMessageId: 'anchor-message-1',
    });
    const transport = {
      sendText: vi.fn(async () => undefined),
      sendCard: vi.fn(async () => 'anchor-message-2'),
      updateCard: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => undefined),
    };

    await runFeishuConversation({
      conversationId: 'session-chat-1',
      target: {
        chatId: 'session-chat-1',
      },
      prompt: 'follow up',
      mode: 'code',
      transport,
      defaultCwd: process.cwd(),
    });

    expect(transport.sendCard).not.toHaveBeenCalled();
    expect(transport.updateCard).toHaveBeenCalledTimes(2);
  });

  it('uses the same expanded control-panel payload for anchor and menu entry points', async () => {
    rememberFeishuSessionChat(buildFeishuSessionChatRecord({
      sourceP2pChatId: 'p2p-chat-1',
      sourceMessageId: 'message-1',
      sessionChatId: 'session-chat-1',
      creatorOpenId: 'ou_user_1',
      createdAt: '2026-03-08T10:00:00.000Z',
      prompt: 'follow up',
    }));
    const transport = {
      sendText: vi.fn(async () => undefined),
      sendCard: vi.fn(async () => undefined),
      updateCard: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => undefined),
    };
    const target = {
      chatId: 'session-chat-1',
    };

    await openFeishuSessionControlPanel({
      conversationId: 'session-chat-1',
      target,
      transport,
    });
    await openFeishuSessionControlPanel({
      conversationId: 'session-chat-1',
      target,
      transport,
      requireKnownSessionChat: true,
    });

    expect(transport.sendCard).toHaveBeenCalledTimes(2);
    expect(transport.sendCard.mock.calls[0]?.[1]).toEqual(
      buildFeishuSessionControlPanelPayload('session-chat-1', {
        conversationId: 'session-chat-1',
        chatId: 'session-chat-1',
      }),
    );
    expect(transport.sendCard.mock.calls[1]?.[1]).toEqual(transport.sendCard.mock.calls[0]?.[1]);
  });

  it('returns explanatory text instead of an active panel for non-session chats', async () => {
    const transport = {
      sendText: vi.fn(async () => undefined),
      sendCard: vi.fn(async () => undefined),
      updateCard: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => undefined),
    };

    await openFeishuSessionControlPanel({
      conversationId: 'group-chat-1',
      target: {
        chatId: 'group-chat-1',
      },
      transport,
      requireKnownSessionChat: true,
    });

    expect(transport.sendCard).not.toHaveBeenCalled();
    expect(transport.sendText).toHaveBeenCalledWith({
      chatId: 'group-chat-1',
    }, FEISHU_NON_SESSION_CONTROL_TEXT);
  });

  it('recognizes /done as a session control command', () => {
    expect(isFeishuDoneCommand('/done')).toBe(true);
    expect(isFeishuDoneCommand(' /DONE ')).toBe(true);
    expect(isFeishuDoneCommand('implement /done support')).toBe(false);
  });

  it('continues the run when startup notifications fail to send', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const transport = {
      sendText: vi.fn(async () => {
        throw new Error('Feishu send message failed with HTTP 400.');
      }),
      sendCard: vi.fn(async () => {
        throw new Error('Feishu send message failed with HTTP 400.');
      }),
      updateCard: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => undefined),
    };

    const result = await runFeishuConversation({
      conversationId: 'session-chat-1',
      target: {
        chatId: 'session-chat-1',
      },
      prompt: 'follow up',
      mode: 'code',
      transport,
      defaultCwd: process.cwd(),
    });

    expect(result).toEqual({ kind: 'started' });
    expect(coreMocks.runPlatformConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'session-chat-1',
      prompt: 'follow up',
    }));
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it('falls back to sending a replacement anchor when in-place update fails', async () => {
    rememberFeishuSessionChat({
      ...buildFeishuSessionChatRecord({
        sourceP2pChatId: 'p2p-chat-1',
        sourceMessageId: 'message-1',
        sessionChatId: 'session-chat-2',
        creatorOpenId: 'ou_user_1',
        createdAt: '2026-03-08T10:00:00.000Z',
        prompt: 'follow up',
      }),
      anchorMessageId: 'anchor-message-1',
    });
    const transport = {
      sendText: vi.fn(async () => undefined),
      sendCard: vi.fn(async () => 'anchor-message-2'),
      updateCard: vi.fn(async () => {
        throw new Error('Feishu update card message failed with HTTP 400.');
      }),
      uploadFile: vi.fn(async () => undefined),
    };
    const persistState = vi.fn(async () => undefined);

    await runFeishuConversation({
      conversationId: 'session-chat-2',
      target: {
        chatId: 'session-chat-2',
      },
      prompt: 'follow up',
      mode: 'code',
      transport,
      defaultCwd: process.cwd(),
      persistState,
    });

    expect(transport.updateCard).toHaveBeenCalled();
    expect(transport.sendCard).toHaveBeenCalled();
    expect(getFeishuSessionChat('session-chat-2')).toEqual(expect.objectContaining({
      anchorMessageId: 'anchor-message-2',
      lastRunStatus: 'idle',
    }));
    expect(persistState).toHaveBeenCalled();
  });

  it('refreshes the anchor summary after control changes', async () => {
    rememberFeishuSessionChat({
      ...buildFeishuSessionChatRecord({
        sourceP2pChatId: 'p2p-chat-1',
        sourceMessageId: 'message-1',
        sessionChatId: 'session-chat-3',
        creatorOpenId: 'ou_user_1',
        createdAt: '2026-03-08T10:00:00.000Z',
        prompt: 'follow up',
      }),
      anchorMessageId: 'anchor-message-1',
    });
    coreMocks.applySessionControlCommand.mockReturnValue({
      kind: 'backend',
      conversationId: 'session-chat-3',
      stateChanged: true,
      persist: true,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'backend.updated',
      backend: 'codex',
    });
    conversationBackend.set('session-chat-3', 'codex');
    const transport = {
      sendText: vi.fn(async () => undefined),
      sendCard: vi.fn(async () => undefined),
      updateCard: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => undefined),
    };
    const persistState = vi.fn(async () => undefined);

    await handleFeishuControlAction({
      action: {
        conversationId: 'session-chat-3',
        type: 'backend',
        value: 'codex',
      },
      target: {
        chatId: 'session-chat-3',
      },
      transport,
      persist: persistState,
    });

    expect(getFeishuSessionChat('session-chat-3')).toEqual(expect.objectContaining({
      lastKnownBackend: 'codex',
      lastRunStatus: 'idle',
    }));
    expect(transport.updateCard).toHaveBeenCalledOnce();
  });
});
