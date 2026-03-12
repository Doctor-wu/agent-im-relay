import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { clientMock, restMock } = vi.hoisted(() => ({
  clientMock: {
    once: vi.fn(),
    on: vi.fn(),
    rest: { on: vi.fn() },
    user: { id: 'relay-bot' },
    destroy: vi.fn(),
    isReady: vi.fn(() => true),
    login: vi.fn(),
  },
  restMock: {
    setToken: vi.fn(function setToken() {
      return this;
    }),
    put: vi.fn(),
  },
}));

vi.mock('discord.js', () => ({
  Client: vi.fn(() => clientMock),
  Events: {
    ClientReady: 'ready',
    Error: 'error',
    InteractionCreate: 'interactionCreate',
    MessageCreate: 'messageCreate',
  },
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    MessageContent: 4,
  },
  REST: vi.fn(() => restMock),
  Routes: {
    applicationGuildCommands: vi.fn(),
    applicationCommands: vi.fn(),
  },
  SlashCommandBuilder: class {},
}));

vi.mock('@agent-im-relay/core', () => ({
  config: {
    claudeCwd: '/tmp/project',
    artifactMaxSizeBytes: 1024,
  },
  preprocessConversationMessage: vi.fn((content: string) => ({
    prompt: content.trim(),
    directives: [],
  })),
  applyMessageControlDirectives: vi.fn(() => []),
  getAvailableBackendCapabilities: vi.fn(async () => [
    {
      name: 'claude',
      models: [
        { id: 'sonnet', label: 'Sonnet' },
      ],
    },
    {
      name: 'codex',
      models: [],
    },
  ]),
  conversationBackend: new Map(),
  conversationModels: new Map(),
  activeConversations: new Set(),
  processedMessages: new Set(),
  pendingConversationCreation: new Set(),
  persistState: vi.fn(async () => {}),
  initState: vi.fn(async () => {}),
  listSkills: vi.fn(async () => []),
  Orchestrator: class {},
}));

vi.mock('../adapter.js', () => ({
  createDiscordAdapter: vi.fn(() => ({ name: 'discord' })),
}));

vi.mock('../conversation.js', () => ({
  hasOpenStickyThreadSession: vi.fn(() => false),
  runMentionConversation: vi.fn(async () => true),
}));

vi.mock('../files.js', () => ({
  collectMessageAttachments: vi.fn(() => []),
}));

vi.mock('../thread.js', () => ({
  ensureMentionThread: vi.fn(),
}));

vi.mock('../commands/ask.js', () => ({
  askCommand: { toJSON: () => ({}) },
  handleAskCommand: vi.fn(),
}));

vi.mock('../commands/code.js', () => ({
  codeCommand: { toJSON: () => ({}) },
  handleCodeCommand: vi.fn(),
}));

vi.mock('../commands/done.js', () => ({
  doneCommand: { toJSON: () => ({}) },
  handleDoneCommand: vi.fn(),
}));

vi.mock('../commands/interrupt.js', () => ({
  interruptCommand: { toJSON: () => ({}) },
  handleInterruptCommand: vi.fn(),
}));

vi.mock('../commands/agent-control.js', () => ({
  agentControlCommandHandlers: new Map(),
  agentControlCommands: [],
}));

vi.mock('../commands/skill.js', () => ({
  handleSkillAutocomplete: vi.fn(),
  handleSkillCommand: vi.fn(),
  skillCommand: { toJSON: () => ({}) },
}));

vi.mock('../commands/thread-setup.js', () => ({
  promptThreadSetup: vi.fn(async () => ({ kind: 'skip' })),
  applySetupResult: vi.fn(async () => {}),
}));

import { handleDiscordMessageCreate } from '../index.js';
import { handleSkillAutocomplete } from '../commands/skill.js';
import { config as discordConfig } from '../config.js';
import {
  applyMessageControlDirectives,
  getAvailableBackendCapabilities,
  persistState,
  preprocessConversationMessage,
} from '@agent-im-relay/core';

const interactionCreateHandler = clientMock.on.mock.calls.find(
  ([event]) => event === 'interactionCreate',
)?.[1];

let messageCounter = 0;

function createBaseMessage() {
  const send = vi.fn().mockResolvedValue({});
  return {
    id: `msg-${++messageCounter}`,
    content: '<@relay-bot> run this',
    author: {
      id: 'other-bot',
      bot: true,
      displayName: 'Other Bot',
      tag: 'Other Bot#0001',
    },
    inGuild: () => true,
    react: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    channel: {
      id: 'channel-1',
      isThread: () => false,
      send,
    },
  } as any;
}

describe('handleDiscordMessageCreate', () => {
  beforeEach(() => {
    clientMock.once.mockClear();
    clientMock.on.mockClear();
    clientMock.rest.on.mockClear();
    vi.mocked(preprocessConversationMessage).mockReset();
    vi.mocked(preprocessConversationMessage).mockImplementation((content: string) => ({
      prompt: content.trim(),
      directives: [],
    }));
    vi.mocked(applyMessageControlDirectives).mockReset();
    vi.mocked(applyMessageControlDirectives).mockReturnValue([]);
    vi.mocked(getAvailableBackendCapabilities).mockClear();
    vi.mocked(persistState).mockClear();
  });

  it('uses mention-aware channel sends when a bot mention has no prompt body', async () => {
    const message = createBaseMessage();
    message.content = '<@relay-bot>';

    await handleDiscordMessageCreate(message, {
      botUser: { id: 'relay-bot' },
      hasOpenStickyThreadSession: () => false,
      runThreadConversation: vi.fn(),
      ensureMentionThread: vi.fn(),
      promptThreadSetup: vi.fn(),
      applySetupResult: vi.fn(),
    });

    expect(message.channel.send).toHaveBeenCalledWith({
      content: '<@other-bot> Please include a prompt after mentioning me.',
      allowedMentions: { users: ['other-bot'] },
    });
    expect(message.reply).not.toHaveBeenCalled();
  });

  it('uses mention-aware channel sends on non-thread startup errors for bot triggers', async () => {
    const message = createBaseMessage();

    await handleDiscordMessageCreate(message, {
      botUser: { id: 'relay-bot' },
      hasOpenStickyThreadSession: () => false,
      runThreadConversation: vi.fn(),
      ensureMentionThread: vi.fn(async () => {
        throw new Error('boom');
      }),
      promptThreadSetup: vi.fn(),
      applySetupResult: vi.fn(),
    });

    expect(message.channel.send).toHaveBeenCalledWith({
      content: '<@other-bot> ❌ boom',
      allowedMentions: { users: ['other-bot'] },
    });
    expect(message.reply).not.toHaveBeenCalled();
  });

  it('routes skill autocomplete interactions to the skill handler', async () => {
    const interaction = {
      isChatInputCommand: () => false,
      isAutocomplete: () => true,
      commandName: 'skill',
    } as any;

    await interactionCreateHandler?.(interaction);

    expect(handleSkillAutocomplete).toHaveBeenCalledWith(interaction);
  });

  it('applies control tags before starting a new thread run', async () => {
    const message = createBaseMessage();
    message.content = '<@relay-bot> <set-backend>codex</set-backend>\nship it';
    const thread = {
      id: 'thread-setup-1',
      send: vi.fn(async () => undefined),
    } as any;
    const ensureMentionThread = vi.fn(async () => thread);
    const runThreadConversation = vi.fn(async () => true);

    vi.mocked(preprocessConversationMessage).mockReturnValue({
      prompt: 'ship it',
      directives: [{ type: 'backend', value: 'codex' }],
    });
    vi.mocked(applyMessageControlDirectives).mockReturnValue([
      {
        kind: 'backend',
        conversationId: 'thread-setup-1',
        stateChanged: true,
        persist: true,
        clearContinuation: false,
        requiresConfirmation: false,
        summaryKey: 'backend.updated',
        backend: 'codex',
      },
    ]);

    await handleDiscordMessageCreate(message, {
      botUser: { id: 'relay-bot' },
      hasOpenStickyThreadSession: () => false,
      runThreadConversation,
      ensureMentionThread,
      promptThreadSetup: vi.fn(async () => ({ backend: 'codex', model: null, cwd: null })),
      applySetupResult: vi.fn(),
    });

    expect(preprocessConversationMessage).toHaveBeenCalledWith('<set-backend>codex</set-backend> ship it');
    expect(ensureMentionThread).toHaveBeenCalledWith(message, 'ship it');
    expect(applyMessageControlDirectives).toHaveBeenCalledWith({
      conversationId: 'thread-setup-1',
      directives: [{ type: 'backend', value: 'codex' }],
    });
    expect(persistState).toHaveBeenCalledWith('discord');
    expect(runThreadConversation).toHaveBeenCalledWith(thread, 'ship it', message, {
      mentionUserId: 'other-bot',
    });
  });

  it('persists pure control-tag messages in threads without starting a run', async () => {
    const message = createBaseMessage();
    const runThreadConversation = vi.fn(async () => true);
    message.channel = {
      id: 'thread-control-1',
      isThread: () => true,
      send: vi.fn(async () => undefined),
    };
    message.content = '<@relay-bot> <set-backend>codex</set-backend>';

    vi.mocked(preprocessConversationMessage).mockReturnValue({
      prompt: '',
      directives: [{ type: 'backend', value: 'codex' }],
    });
    vi.mocked(applyMessageControlDirectives).mockReturnValue([
      {
        kind: 'backend',
        conversationId: 'thread-control-1',
        stateChanged: true,
        persist: true,
        clearContinuation: false,
        requiresConfirmation: false,
        summaryKey: 'backend.updated',
        backend: 'codex',
      },
    ]);

    await handleDiscordMessageCreate(message, {
      botUser: { id: 'relay-bot' },
      hasOpenStickyThreadSession: () => true,
      runThreadConversation,
      ensureMentionThread: vi.fn(),
      promptThreadSetup: vi.fn(),
      applySetupResult: vi.fn(),
    });

    expect(applyMessageControlDirectives).toHaveBeenCalledWith({
      conversationId: 'thread-control-1',
      directives: [{ type: 'backend', value: 'codex' }],
    });
    expect(persistState).toHaveBeenCalledWith('discord');
    expect(runThreadConversation).not.toHaveBeenCalled();
    expect(message.channel.send).not.toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Please include a prompt'),
    }));
  });

  it('creates a new thread for standalone control-tag mentions and persists directives', async () => {
    const message = createBaseMessage();
    const thread = {
      id: 'thread-control-setup-1',
      send: vi.fn(async () => undefined),
    } as any;
    const ensureMentionThread = vi.fn(async () => thread);
    const runThreadConversation = vi.fn(async () => true);
    message.content = '<@relay-bot> <set-backend>codex</set-backend>';

    vi.mocked(preprocessConversationMessage).mockReturnValue({
      prompt: '',
      directives: [{ type: 'backend', value: 'codex' }],
    });
    vi.mocked(applyMessageControlDirectives).mockReturnValue([
      {
        kind: 'backend',
        conversationId: 'thread-control-setup-1',
        stateChanged: true,
        persist: true,
        clearContinuation: false,
        requiresConfirmation: false,
        summaryKey: 'backend.updated',
        backend: 'codex',
      },
    ]);

    await handleDiscordMessageCreate(message, {
      botUser: { id: 'relay-bot' },
      hasOpenStickyThreadSession: () => false,
      runThreadConversation,
      ensureMentionThread,
      promptThreadSetup: vi.fn(),
      applySetupResult: vi.fn(),
    });

    expect(ensureMentionThread).toHaveBeenCalledWith(message, '');
    expect(thread.send).not.toHaveBeenCalled();
    expect(applyMessageControlDirectives).toHaveBeenCalledWith({
      conversationId: 'thread-control-setup-1',
      directives: [{ type: 'backend', value: 'codex' }],
    });
    expect(persistState).toHaveBeenCalledWith('discord');
    expect(runThreadConversation).not.toHaveBeenCalled();
    expect(message.channel.send).not.toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Please include a prompt'),
    }));
  });

  it('still prompts setup when the backend is preset but the thread has no model yet', async () => {
    const message = createBaseMessage();
    message.content = '<@relay-bot> <set-backend>claude</set-backend>\nship it';

    const { conversationBackend, conversationModels } = await import('@agent-im-relay/core');
    conversationBackend.set('thread-model-setup-1', 'claude');
    conversationModels.delete('thread-model-setup-1');

    const thread = {
      id: 'thread-model-setup-1',
      send: vi.fn(async () => undefined),
    } as any;
    const ensureMentionThread = vi.fn(async () => thread);
    const promptThreadSetup = vi.fn(async () => ({ backend: 'claude', model: 'sonnet', cwd: null }));
    const applySetupResult = vi.fn(async () => {});
    const runThreadConversation = vi.fn(async () => true);

    vi.mocked(preprocessConversationMessage).mockReturnValue({
      prompt: 'ship it',
      directives: [{ type: 'backend', value: 'claude' }],
    });
    vi.mocked(applyMessageControlDirectives).mockReturnValue([
      {
        kind: 'backend',
        conversationId: 'thread-model-setup-1',
        stateChanged: false,
        persist: false,
        clearContinuation: false,
        requiresConfirmation: false,
        summaryKey: 'backend.updated',
        backend: 'claude',
      },
    ]);

    await handleDiscordMessageCreate(message, {
      botUser: { id: 'relay-bot' },
      hasOpenStickyThreadSession: () => false,
      runThreadConversation,
      ensureMentionThread,
      promptThreadSetup,
      applySetupResult,
    });

    expect(promptThreadSetup).toHaveBeenCalledWith(thread, 'ship it', {
      presetBackend: 'claude',
    });
    expect(applySetupResult).toHaveBeenCalledWith('thread-model-setup-1', {
      backend: 'claude',
      model: 'sonnet',
      cwd: null,
    });
    expect(runThreadConversation).toHaveBeenCalledWith(thread, 'ship it', message, {
      mentionUserId: 'other-bot',
    });
  });

  it('skips capability lookup when backend and model are already configured', async () => {
    const message = createBaseMessage();
    message.content = '<@relay-bot> ship it';

    const { conversationBackend, conversationModels } = await import('@agent-im-relay/core');
    conversationBackend.set('thread-model-ready-1', 'claude');
    conversationModels.set('thread-model-ready-1', 'sonnet');

    const thread = {
      id: 'thread-model-ready-1',
      send: vi.fn(async () => undefined),
    } as any;

    const ensureMentionThread = vi.fn(async () => thread);
    const runThreadConversation = vi.fn(async () => true);
    const promptThreadSetup = vi.fn();

    vi.mocked(preprocessConversationMessage).mockReturnValue({
      prompt: 'ship it',
      directives: [],
    });

    await handleDiscordMessageCreate(message, {
      botUser: { id: 'relay-bot' },
      hasOpenStickyThreadSession: () => false,
      runThreadConversation,
      ensureMentionThread,
      promptThreadSetup,
      applySetupResult: vi.fn(),
    });

    expect(getAvailableBackendCapabilities).not.toHaveBeenCalled();
    expect(promptThreadSetup).not.toHaveBeenCalled();
    expect(runThreadConversation).toHaveBeenCalledWith(thread, 'ship it', message, {
      mentionUserId: 'other-bot',
    });
  });
});

describe('allowedChannelIds filter', () => {
  afterEach(() => {
    discordConfig.allowedChannelIds = [];
  });

  it('drops messages from channels not in the allowlist', async () => {
    discordConfig.allowedChannelIds = ['allowed-channel'];

    const message = createBaseMessage();
    message.channel.id = 'other-channel';

    await handleDiscordMessageCreate(message, {
      botUser: { id: 'relay-bot' },
      hasOpenStickyThreadSession: () => false,
      runThreadConversation: vi.fn(),
      ensureMentionThread: vi.fn(),
      promptThreadSetup: vi.fn(),
      applySetupResult: vi.fn(),
    });

    expect(message.react).not.toHaveBeenCalled();
  });

  it('accepts messages from allowed channels', async () => {
    discordConfig.allowedChannelIds = ['allowed-channel'];

    const message = createBaseMessage();
    message.channel.id = 'allowed-channel';

    const ensureMentionThread = vi.fn(async () => ({
      id: 'thread-1',
      send: vi.fn(async () => undefined),
    }));

    await handleDiscordMessageCreate(message, {
      botUser: { id: 'relay-bot' },
      hasOpenStickyThreadSession: () => false,
      runThreadConversation: vi.fn(async () => true),
      ensureMentionThread,
      promptThreadSetup: vi.fn(async () => ({ kind: 'skip' })),
      applySetupResult: vi.fn(),
    });

    expect(message.react).toHaveBeenCalled();
  });

  it('accepts thread messages whose parent is in the allowlist', async () => {
    discordConfig.allowedChannelIds = ['allowed-channel'];

    const message = createBaseMessage();
    message.channel = {
      id: 'thread-in-allowed',
      parentId: 'allowed-channel',
      isThread: () => true,
      send: vi.fn(async () => undefined),
    };

    await handleDiscordMessageCreate(message, {
      botUser: { id: 'relay-bot' },
      hasOpenStickyThreadSession: () => true,
      runThreadConversation: vi.fn(async () => true),
      ensureMentionThread: vi.fn(),
      promptThreadSetup: vi.fn(),
      applySetupResult: vi.fn(),
    });

    expect(message.react).toHaveBeenCalled();
  });

  it('drops thread messages whose parent is not in the allowlist', async () => {
    discordConfig.allowedChannelIds = ['allowed-channel'];

    const message = createBaseMessage();
    message.channel = {
      id: 'thread-in-other',
      parentId: 'other-channel',
      isThread: () => true,
      send: vi.fn(async () => undefined),
    };

    await handleDiscordMessageCreate(message, {
      botUser: { id: 'relay-bot' },
      hasOpenStickyThreadSession: () => true,
      runThreadConversation: vi.fn(),
      ensureMentionThread: vi.fn(),
      promptThreadSetup: vi.fn(),
      applySetupResult: vi.fn(),
    });

    expect(message.react).not.toHaveBeenCalled();
  });

  it('allows all channels when allowedChannelIds is empty', async () => {
    discordConfig.allowedChannelIds = [];

    const message = createBaseMessage();
    message.channel.id = 'any-channel';

    const ensureMentionThread = vi.fn(async () => ({
      id: 'thread-1',
      send: vi.fn(async () => undefined),
    }));

    await handleDiscordMessageCreate(message, {
      botUser: { id: 'relay-bot' },
      hasOpenStickyThreadSession: () => false,
      runThreadConversation: vi.fn(async () => true),
      ensureMentionThread,
      promptThreadSetup: vi.fn(async () => ({ kind: 'skip' })),
      applySetupResult: vi.fn(),
    });

    expect(message.react).toHaveBeenCalled();
  });
});
