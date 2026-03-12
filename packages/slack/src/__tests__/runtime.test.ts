import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const coreMocks = vi.hoisted(() => ({
  applySessionControlCommand: vi.fn(),
  evaluateConversationRunRequest: vi.fn(),
  getAvailableBackendCapabilities: vi.fn(async () => [
    {
      name: 'claude',
      models: [
        { id: 'sonnet', label: 'Sonnet' },
        { id: 'opus', label: 'Opus' },
      ],
    },
    {
      name: 'opencode',
      models: [],
    },
  ]),
  getAvailableBackendNames: vi.fn(async () => ['claude', 'opencode']),
  listSkills: vi.fn(async () => [
    {
      name: 'brainstorming',
      description: 'Design first',
      dir: '/tmp/brainstorming',
    },
  ]),
  resolveBackendModelId: vi.fn((backend: string, model: string) => {
    if (backend === 'claude' && (model === 'sonnet' || model === 'claude/sonnet')) {
      return 'sonnet';
    }
    return undefined;
  }),
  runPlatformConversation: vi.fn(async () => true),
}));

vi.mock('@agent-im-relay/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agent-im-relay/core')>();
  return {
    ...actual,
    applySessionControlCommand: coreMocks.applySessionControlCommand,
    evaluateConversationRunRequest: coreMocks.evaluateConversationRunRequest,
    getAvailableBackendCapabilities: coreMocks.getAvailableBackendCapabilities,
    getAvailableBackendNames: coreMocks.getAvailableBackendNames,
    listSkills: coreMocks.listSkills,
    resolveBackendModelId: coreMocks.resolveBackendModelId,
    runPlatformConversation: coreMocks.runPlatformConversation,
  };
});

import {
  conversationBackend,
  conversationMode,
  conversationModels,
} from '@agent-im-relay/core';

function createMockTransport() {
  return {
    createThread: vi.fn(async ({ channelId }: { channelId: string }) => ({
      channelId,
      threadTs: '1741766400.123456',
      rootMessageTs: '1741766400.123456',
    })),
    sendMessage: vi.fn(async () => ({ ts: '1741766401.000001' })),
    updateMessage: vi.fn(async () => undefined),
    showSelectMenu: vi.fn(async () => undefined),
    sendText: vi.fn(async () => undefined),
    sendBlocks: vi.fn(async () => '1741766402.000001'),
    updateBlocks: vi.fn(async () => undefined),
    sendCommandResponse: vi.fn(async () => undefined),
  };
}

afterEach(async () => {
  vi.useRealTimers();
  const { resetSlackRuntimeForTests } = await import('../runtime.js');
  const { resetSlackStateForTests } = await import('../state.js');
  resetSlackRuntimeForTests();
  resetSlackStateForTests();
});

describe('Slack runtime', () => {
  beforeEach(() => {
    conversationBackend.clear();
    conversationModels.clear();
    conversationMode.clear();
    coreMocks.applySessionControlCommand.mockReset();
    coreMocks.evaluateConversationRunRequest.mockReset();
    coreMocks.getAvailableBackendCapabilities.mockClear();
    coreMocks.getAvailableBackendNames.mockClear();
    coreMocks.listSkills.mockClear();
    coreMocks.resolveBackendModelId.mockClear();
    coreMocks.runPlatformConversation.mockReset();
    coreMocks.runPlatformConversation.mockResolvedValue(true);
    coreMocks.evaluateConversationRunRequest.mockReturnValue({
      kind: 'ready',
      conversationId: '1741766400.123456',
      backend: 'opencode',
    });
    coreMocks.applySessionControlCommand.mockImplementation(({ conversationId, type, value }: any) => {
      if (type === 'backend') {
        conversationBackend.set(conversationId, value);
        return {
          kind: 'backend',
          conversationId,
          backend: value,
          stateChanged: true,
          persist: true,
          clearContinuation: false,
          requiresConfirmation: false,
          summaryKey: 'backend.updated',
        };
      }

      if (type === 'model') {
        conversationModels.set(conversationId, String(value));
        return {
          kind: 'model',
          conversationId,
          value: String(value),
          stateChanged: true,
          persist: true,
          clearContinuation: false,
          requiresConfirmation: false,
          summaryKey: 'model.updated',
        };
      }

      if (type === 'interrupt') {
        return {
          kind: 'interrupt',
          conversationId,
          interrupted: true,
          stateChanged: false,
          persist: false,
          clearContinuation: false,
          requiresConfirmation: false,
          summaryKey: 'interrupt.ok',
        };
      }

      return {
        kind: 'done',
        conversationId,
        stateChanged: true,
        persist: false,
        clearContinuation: true,
        requiresConfirmation: false,
        summaryKey: 'done.ok',
      };
    });
  });

  it('registers Socket Mode handlers for commands, actions, and messages', async () => {
    const { createSlackRuntime } = await import('../runtime.js');
    const transport = createMockTransport();
    const app = {
      command: vi.fn(),
      action: vi.fn(),
      event: vi.fn(),
      start: vi.fn(async () => undefined),
    };

    const runtime = createSlackRuntime({
      config: {
        agentTimeoutMs: 1_000,
        claudeCwd: process.cwd(),
        stateFile: '/tmp/slack-runtime-state.json',
        artifactsBaseDir: '/tmp/slack-runtime-artifacts',
        artifactRetentionDays: 14,
        artifactMaxSizeBytes: 8 * 1024 * 1024,
        claudeBin: 'claude',
        codexBin: 'codex',
        opencodeBin: 'opencode',
        slackBotToken: 'xoxb-test',
        slackAppToken: 'xapp-test',
        slackSigningSecret: 'signing-secret',
        slackSocketMode: true,
      },
      transport,
      defaultCwd: process.cwd(),
      createApp: () => app as any,
    });

    await runtime.start();

    expect(app.command).toHaveBeenCalledWith('/code', expect.any(Function));
    expect(app.command).toHaveBeenCalledWith('/ask', expect.any(Function));
    expect(app.command).toHaveBeenCalledWith('/interrupt', expect.any(Function));
    expect(app.command).toHaveBeenCalledWith('/done', expect.any(Function));
    expect(app.command).toHaveBeenCalledWith('/skill', expect.any(Function));
    expect(app.action).toHaveBeenCalled();
    expect(app.event).toHaveBeenCalledWith('message', expect.any(Function));
    expect(app.start).toHaveBeenCalledOnce();
  });

  it('throws on start when no Slack config is provided from options or env', async () => {
    const { createSlackRuntime } = await import('../runtime.js');
    const transport = createMockTransport();
    const app = {
      command: vi.fn(),
      action: vi.fn(),
      event: vi.fn(),
      start: vi.fn(async () => undefined),
    };

    const runtime = createSlackRuntime({
      transport,
      defaultCwd: process.cwd(),
      createApp: () => app as any,
    });

    await expect(runtime.start()).rejects.toThrow('Missing required environment variable: SLACK_BOT_TOKEN');
  });

  it('always creates a fresh thread for /code and starts the run there', async () => {
    const { createSlackRuntime } = await import('../runtime.js');
    const transport = createMockTransport();
    const runtime = createSlackRuntime({
      transport,
      defaultCwd: process.cwd(),
    });

    const result = await runtime.handleCommand({
      command: '/code',
      text: 'ship it',
      channel_id: 'C123',
      thread_ts: '1741000000.000001',
      user_id: 'U123',
      user_name: 'Alice',
      trigger_id: 'trigger-1',
      command_ts: 'cmd-1',
    });

    expect(result).toEqual({
      kind: 'started',
      conversationId: '1741766400.123456',
      mode: 'code',
    });
    expect(transport.createThread).toHaveBeenCalledWith({
      channelId: 'C123',
      authorName: 'Alice',
      prompt: 'ship it',
    });
    expect(coreMocks.runPlatformConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: '1741766400.123456',
      prompt: 'ship it',
      mode: 'code',
    }));
  });

  it('rejects control commands outside mapped conversation threads', async () => {
    const { createSlackRuntime } = await import('../runtime.js');
    const transport = createMockTransport();
    const runtime = createSlackRuntime({
      transport,
      defaultCwd: process.cwd(),
    });

    const result = await runtime.handleCommand({
      command: '/interrupt',
      text: '',
      channel_id: 'C123',
      user_id: 'U123',
      user_name: 'Alice',
      trigger_id: 'trigger-2',
      command_ts: 'cmd-2',
    });

    expect(result).toEqual({
      kind: 'error',
      message: 'This command only works inside an active Slack conversation thread.',
    });
    expect(transport.sendCommandResponse).toHaveBeenCalledWith(expect.objectContaining({
      command: '/interrupt',
    }), 'This command only works inside an active Slack conversation thread.');
  });

  it('stores blocked runs and resumes them after backend selection', async () => {
    const { createSlackRuntime } = await import('../runtime.js');
    const transport = createMockTransport();
    const runtime = createSlackRuntime({
      transport,
      defaultCwd: process.cwd(),
    });

    coreMocks.evaluateConversationRunRequest
      .mockReturnValueOnce({
        kind: 'setup-required',
        conversationId: '1741766400.123456',
        reason: 'backend-selection',
      })
      .mockReturnValueOnce({
        kind: 'ready',
        conversationId: '1741766400.123456',
        backend: 'opencode',
      });

    await expect(runtime.handleCommand({
      command: '/code',
      text: 'ship it',
      channel_id: 'C123',
      user_id: 'U123',
      user_name: 'Alice',
      trigger_id: 'trigger-3',
      command_ts: 'cmd-3',
    })).resolves.toEqual({
      kind: 'blocked',
      conversationId: '1741766400.123456',
      reason: 'backend-selection',
    });

    expect(coreMocks.runPlatformConversation).not.toHaveBeenCalled();
    expect(transport.sendBlocks).toHaveBeenCalled();

    await expect(runtime.handleAction({
      channel: { id: 'C123' },
      message: {
        ts: '1741766402.000001',
        thread_ts: '1741766400.123456',
      },
      actions: [
        {
          action_id: 'backend:opencode',
          value: JSON.stringify({
            type: 'backend',
            conversationId: '1741766400.123456',
            value: 'opencode',
          }),
        },
      ],
      user: { id: 'U123' },
    })).resolves.toEqual({
      kind: 'started',
      conversationId: '1741766400.123456',
    });

    expect(coreMocks.runPlatformConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: '1741766400.123456',
      backend: 'opencode',
      prompt: 'ship it',
    }));
  });

  it('auto-selects a model after timeout and resumes the pending run', async () => {
    vi.useFakeTimers();
    const { createSlackRuntime } = await import('../runtime.js');
    const transport = createMockTransport();
    const runtime = createSlackRuntime({
      transport,
      defaultCwd: process.cwd(),
      modelSelectionTimeoutMs: 10_000,
    });

    coreMocks.evaluateConversationRunRequest.mockReturnValueOnce({
      kind: 'ready',
      conversationId: '1741766400.123456',
      backend: 'claude',
    });
    conversationBackend.set('1741766400.123456', 'claude');

    await expect(runtime.handleCommand({
      command: '/code',
      text: 'ship it',
      channel_id: 'C123',
      user_id: 'U123',
      user_name: 'Alice',
      trigger_id: 'trigger-4',
      command_ts: 'cmd-4',
    })).resolves.toEqual({
      kind: 'blocked',
      conversationId: '1741766400.123456',
      reason: 'model-selection',
    });

    expect(coreMocks.runPlatformConversation).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(conversationModels.get('1741766400.123456')).toBe('sonnet');
    expect(coreMocks.runPlatformConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: '1741766400.123456',
      backend: 'claude',
    }));
  });

  it('clears the pending run when model auto-selection cannot choose a fallback', async () => {
    vi.useFakeTimers();
    const { createSlackRuntime, hasPendingSlackRun } = await import('../runtime.js');
    const transport = createMockTransport();
    const runtime = createSlackRuntime({
      transport,
      defaultCwd: process.cwd(),
      modelSelectionTimeoutMs: 10_000,
    });

    coreMocks.evaluateConversationRunRequest.mockReturnValueOnce({
      kind: 'ready',
      conversationId: '1741766400.123456',
      backend: 'claude',
    });
    coreMocks.getAvailableBackendCapabilities.mockResolvedValue([
      {
        name: 'claude',
        models: [
          { id: '', label: 'Broken model' },
        ],
      },
      {
        name: 'opencode',
        models: [],
      },
    ]);
    conversationBackend.set('1741766400.123456', 'claude');

    await expect(runtime.handleCommand({
      command: '/code',
      text: 'ship it',
      channel_id: 'C123',
      user_id: 'U123',
      user_name: 'Alice',
      trigger_id: 'trigger-5',
      command_ts: 'cmd-5',
    })).resolves.toEqual({
      kind: 'blocked',
      conversationId: '1741766400.123456',
      reason: 'model-selection',
    });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(hasPendingSlackRun('1741766400.123456')).toBe(false);
    expect(coreMocks.runPlatformConversation).not.toHaveBeenCalled();
  });

  it('routes active-thread user messages back into the mapped conversation', async () => {
    const { createSlackRuntime } = await import('../runtime.js');
    const { rememberSlackConversation } = await import('../state.js');
    const transport = createMockTransport();
    const runtime = createSlackRuntime({
      transport,
      defaultCwd: process.cwd(),
    });

    rememberSlackConversation({
      conversationId: '1741766400.123456',
      channelId: 'C123',
      threadTs: '1741766400.123456',
      rootMessageTs: '1741766400.123456',
    });
    conversationBackend.set('1741766400.123456', 'opencode');
    conversationMode.set('1741766400.123456', 'ask');

    await expect(runtime.handleMessage({
      channel: 'C123',
      ts: '1741766409.000001',
      thread_ts: '1741766400.123456',
      user: 'U123',
      text: 'continue this thread',
    })).resolves.toEqual({
      kind: 'started',
      conversationId: '1741766400.123456',
      mode: 'ask',
    });

    expect(coreMocks.runPlatformConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: '1741766400.123456',
      prompt: 'continue this thread',
      mode: 'ask',
    }));
  });
});
