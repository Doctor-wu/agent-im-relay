import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const coreMocks = vi.hoisted(() => ({
  applySessionControlCommand: vi.fn(),
  evaluateConversationRunRequest: vi.fn(),
  getAvailableBackendCapabilities: vi.fn(async () => [
    {
      name: 'claude',
      models: [
        { id: 'sonnet', label: 'Sonnet' },
      ],
    },
    {
      name: 'opencode',
      models: [],
    },
  ]),
  getAvailableBackendNames: vi.fn(async () => ['claude', 'opencode']),
  resolveBackendModelId: vi.fn((backend: string, model: string) => {
    if (backend === 'claude' && model === 'sonnet') return 'sonnet';
    if (backend === 'opencode' && (model === 'gpt-5' || model === 'openai/gpt-5')) {
      return 'openai/gpt-5';
    }
    return undefined;
  }),
  runPlatformConversation: vi.fn(),
}));

vi.mock('@agent-im-relay/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agent-im-relay/core')>();
  return {
    ...actual,
    applySessionControlCommand: coreMocks.applySessionControlCommand,
    getAvailableBackendCapabilities: coreMocks.getAvailableBackendCapabilities,
    evaluateConversationRunRequest: coreMocks.evaluateConversationRunRequest,
    getAvailableBackendNames: coreMocks.getAvailableBackendNames,
    resolveBackendModelId: coreMocks.resolveBackendModelId,
    runPlatformConversation: coreMocks.runPlatformConversation,
  };
});

import {
  conversationBackend,
  conversationModels,
  conversationMode,
} from '@agent-im-relay/core';
import { buildFeishuSessionChatRecord, rememberFeishuSessionChat } from '../session-chat.js';
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
    conversationBackend.clear();
    conversationModels.clear();
    conversationMode.clear();
    coreMocks.applySessionControlCommand.mockReset();
    coreMocks.evaluateConversationRunRequest.mockReset();
    coreMocks.getAvailableBackendCapabilities.mockResolvedValue([
      {
        name: 'claude',
        models: [
          { id: 'sonnet', label: 'Sonnet' },
        ],
      },
      {
        name: 'opencode',
        models: [],
      },
    ]);
    coreMocks.getAvailableBackendNames.mockResolvedValue(['claude', 'opencode']);
    coreMocks.resolveBackendModelId.mockReset();
    coreMocks.resolveBackendModelId.mockImplementation((backend: string, model: string) => {
      if (backend === 'claude' && model === 'sonnet') return 'sonnet';
      if (backend === 'opencode' && (model === 'gpt-5' || model === 'openai/gpt-5')) {
        return 'openai/gpt-5';
      }
      return undefined;
    });
    coreMocks.runPlatformConversation.mockReset();

    coreMocks.evaluateConversationRunRequest.mockReturnValue({
      kind: 'ready',
      conversationId: 'conv-1',
      backend: 'claude',
    });
    coreMocks.runPlatformConversation.mockResolvedValue(true);
  });

  it('does not emit startup text or persistent control ui before starting the platform run', async () => {
    conversationModels.set('conv-1', 'sonnet');

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
    expect(transport.sendText).not.toHaveBeenCalledWith(expect.anything(), 'Starting run…');
    expect(transport.sendCard).not.toHaveBeenCalled();
    expect(transport.updateCard).not.toHaveBeenCalled();
    expect(persistState).not.toHaveBeenCalled();
  });

  it('does not send environment summary on sticky-session resumes', async () => {
    conversationModels.set('conv-resume', 'sonnet');

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
        backend: 'opencode',
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
      backend: 'opencode',
    }));
  });

  it('prompts for model selection before resuming a pending run when the backend exposes models', async () => {
    coreMocks.evaluateConversationRunRequest
      .mockReturnValueOnce({
        kind: 'setup-required',
        conversationId: 'conv-model-gated',
        reason: 'backend-selection',
      })
      .mockReturnValueOnce({
        kind: 'ready',
        conversationId: 'conv-model-gated',
        backend: 'claude',
      });

    const transport = {
      sendText: vi.fn(async () => undefined),
      sendCard: vi.fn(async () => undefined),
      updateCard: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => undefined),
    };

    await runFeishuConversation({
      conversationId: 'conv-model-gated',
      target: {
        chatId: 'chat-1',
      },
      prompt: 'ship it',
      mode: 'code',
      transport,
      defaultCwd: process.cwd(),
    });

    conversationBackend.set('conv-model-gated', 'claude');

    await expect(resumePendingFeishuRun({
      conversationId: 'conv-model-gated',
      transport,
      defaultCwd: process.cwd(),
    })).resolves.toEqual({ kind: 'blocked' });

    const modelCard = transport.sendCard.mock.calls.at(-1)?.[1] as Record<string, any>;
    const buttonTexts = modelCard.body.elements
      .filter((element: Record<string, unknown>) => element.tag === 'button')
      .map((button: Record<string, any>) => button.text.content);

    expect(buttonTexts).toEqual(['Sonnet']);
    expect(coreMocks.runPlatformConversation).not.toHaveBeenCalled();
  });

  it('prompts for model selection before starting a run when the backend is already preset', async () => {
    coreMocks.evaluateConversationRunRequest.mockReturnValueOnce({
      kind: 'ready',
      conversationId: 'conv-model-required',
      backend: 'claude',
    });
    conversationBackend.set('conv-model-required', 'claude');

    const transport = {
      sendText: vi.fn(async () => undefined),
      sendCard: vi.fn(async () => undefined),
      updateCard: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => undefined),
    };

    await expect(runFeishuConversation({
      conversationId: 'conv-model-required',
      target: {
        chatId: 'chat-1',
      },
      prompt: 'ship it',
      mode: 'code',
      transport,
      defaultCwd: process.cwd(),
    })).resolves.toEqual({ kind: 'blocked' });

    expect(coreMocks.runPlatformConversation).not.toHaveBeenCalled();
    const modelCard = transport.sendCard.mock.calls.at(-1)?.[1] as Record<string, any>;
    const buttonTexts = modelCard.body.elements
      .filter((element: Record<string, unknown>) => element.tag === 'button')
      .map((button: Record<string, any>) => button.text.content);

    expect(buttonTexts).toEqual(['Sonnet']);
  });

  it('does not re-block legacy OpenCode models that can be normalized to provider/modelKey', async () => {
    coreMocks.evaluateConversationRunRequest.mockReturnValueOnce({
      kind: 'ready',
      conversationId: 'conv-opencode-legacy',
      backend: 'opencode',
    });
    coreMocks.getAvailableBackendCapabilities.mockResolvedValueOnce([
      {
        name: 'claude',
        models: [
          { id: 'sonnet', label: 'Sonnet' },
        ],
      },
      {
        name: 'opencode',
        models: [
          { id: 'openai/gpt-5', label: 'openai/gpt-5' },
        ],
      },
    ]);
    conversationBackend.set('conv-opencode-legacy', 'opencode');
    conversationModels.set('conv-opencode-legacy', 'gpt-5');

    const transport = {
      sendText: vi.fn(async () => undefined),
      sendCard: vi.fn(async () => undefined),
      updateCard: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => undefined),
    };

    await expect(runFeishuConversation({
      conversationId: 'conv-opencode-legacy',
      target: {
        chatId: 'chat-1',
      },
      prompt: 'ship it',
      mode: 'code',
      transport,
      defaultCwd: process.cwd(),
    })).resolves.toEqual({ kind: 'started' });

    expect(coreMocks.runPlatformConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-opencode-legacy',
      backend: 'opencode',
    }));
    expect(conversationModels.get('conv-opencode-legacy')).toBe('openai/gpt-5');
    expect(transport.sendCard).not.toHaveBeenCalled();
  });

  it('returns an error when backend selection is required but no backends are available', async () => {
    coreMocks.evaluateConversationRunRequest.mockReturnValueOnce({
      kind: 'setup-required',
      conversationId: 'conv-empty',
      reason: 'backend-selection',
    });
    coreMocks.getAvailableBackendNames.mockResolvedValueOnce([]);

    const transport = {
      sendText: vi.fn(async () => undefined),
      sendCard: vi.fn(async () => undefined),
      updateCard: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => undefined),
    };

    await expect(runFeishuConversation({
      conversationId: 'conv-empty',
      target: {
        chatId: 'chat-1',
      },
      prompt: 'ship it',
      mode: 'code',
      transport,
      defaultCwd: process.cwd(),
    })).resolves.toEqual({ kind: 'error' });

    expect(transport.sendText).toHaveBeenCalledWith({
      chatId: 'chat-1',
    }, 'No available backends detected.');
    expect(transport.sendCard).not.toHaveBeenCalled();
    expect(coreMocks.runPlatformConversation).not.toHaveBeenCalled();
  });

  it('builds the session control panel from currently available backends', async () => {
    conversationBackend.set('session-chat-1', 'claude');
    const transport = {
      sendText: vi.fn(async () => undefined),
      sendCard: vi.fn(async () => undefined),
      updateCard: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => undefined),
    };

    await openFeishuSessionControlPanel({
      conversationId: 'session-chat-1',
      target: {
        chatId: 'session-chat-1',
      },
      transport,
    });

    const cardPayload = transport.sendCard.mock.calls[0]?.[1] as Record<string, any>;
    const buttonTexts = cardPayload.body.elements
      .filter((element: Record<string, unknown>) => element.tag === 'button')
      .map((button: Record<string, any>) => button.text.content);

    expect(buttonTexts).toEqual([
      'Done',
      'Claude',
      'OpenCode',
      'Sonnet',
      'Low',
      'Medium',
      'High',
    ]);
  });

  it('refreshes the control panel model buttons after a backend change', async () => {
    conversationBackend.set('conv-refresh', 'claude');
    coreMocks.applySessionControlCommand.mockReturnValueOnce({
      kind: 'backend',
      conversationId: 'conv-refresh',
      stateChanged: true,
      persist: true,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'backend.updated',
      backend: 'claude',
    });

    const transport = {
      sendText: vi.fn(async () => undefined),
      sendCard: vi.fn(async () => undefined),
      updateCard: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => undefined),
    };

    await handleFeishuControlAction({
      action: {
        conversationId: 'conv-refresh',
        type: 'backend',
        value: 'claude',
      },
      target: {
        chatId: 'chat-1',
      },
      transport,
    });

    const cardPayload = transport.sendCard.mock.calls[0]?.[1] as Record<string, any>;
    const buttonTexts = cardPayload.body.elements
      .filter((element: Record<string, unknown>) => element.tag === 'button')
      .map((button: Record<string, any>) => button.text.content);

    expect(buttonTexts).toEqual([
      'Done',
      'Claude',
      'OpenCode',
      'Sonnet',
      'Low',
      'Medium',
      'High',
    ]);
  });

  it('does not send persistent control ui for known session chats', async () => {
    conversationModels.set('session-chat-1', 'sonnet');
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
    expect(transport.updateCard).not.toHaveBeenCalled();
  });

  it('uses the same expanded control-panel payload for anchor and menu entry points', async () => {
    conversationBackend.set('session-chat-1', 'claude');
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
      }, ['claude', 'opencode'], [{ id: 'sonnet', label: 'Sonnet' }]),
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

  it('continues the run without depending on startup notifications', async () => {
    conversationModels.set('session-chat-1', 'sonnet');
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
    expect(transport.sendText).not.toHaveBeenCalled();
    expect(transport.sendCard).not.toHaveBeenCalled();
  });

  it('does not attempt anchor recovery for existing session chat metadata', async () => {
    conversationModels.set('session-chat-2', 'sonnet');
    rememberFeishuSessionChat(buildFeishuSessionChatRecord({
      sourceP2pChatId: 'p2p-chat-1',
      sourceMessageId: 'message-1',
      sessionChatId: 'session-chat-2',
      creatorOpenId: 'ou_user_1',
      createdAt: '2026-03-08T10:00:00.000Z',
      prompt: 'follow up',
    }));
    const transport = {
      sendText: vi.fn(async () => undefined),
      sendCard: vi.fn(async () => 'anchor-message-2'),
      updateCard: vi.fn(async () => undefined),
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

    expect(transport.updateCard).not.toHaveBeenCalled();
    expect(transport.sendCard).not.toHaveBeenCalled();
    expect(persistState).not.toHaveBeenCalled();
  });

  it('does not refresh persistent summaries after non-backend control changes', async () => {
    rememberFeishuSessionChat(buildFeishuSessionChatRecord({
      sourceP2pChatId: 'p2p-chat-1',
      sourceMessageId: 'message-1',
      sessionChatId: 'session-chat-3',
      creatorOpenId: 'ou_user_1',
      createdAt: '2026-03-08T10:00:00.000Z',
      prompt: 'follow up',
    }));
    coreMocks.applySessionControlCommand.mockReturnValue({
      kind: 'done',
      conversationId: 'session-chat-3',
      stateChanged: true,
      persist: true,
      clearContinuation: true,
      requiresConfirmation: false,
      summaryKey: 'done.ok',
    });
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
        type: 'done',
      },
      target: {
        chatId: 'session-chat-3',
      },
      transport,
      persist: persistState,
    });

    expect(transport.updateCard).not.toHaveBeenCalled();
    expect(transport.sendCard).not.toHaveBeenCalled();
  });
});
