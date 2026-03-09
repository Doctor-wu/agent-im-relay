import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  conversationBackend: new Map(),
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

vi.mock('../commands/claude-control.js', () => ({
  claudeControlCommandHandlers: new Map(),
  claudeControlCommands: [],
}));

vi.mock('../commands/skill.js', () => ({
  handleSkillCommand: vi.fn(),
  handleSkillModalSubmit: vi.fn(),
  handleSkillSelectMenu: vi.fn(),
  skillCommand: { toJSON: () => ({}) },
  SKILL_MODAL_CUSTOM_ID_PREFIX: 'skill-modal:',
  SKILL_SELECT_CUSTOM_ID: 'skill-select',
}));

vi.mock('../commands/thread-setup.js', () => ({
  promptThreadSetup: vi.fn(async () => ({ kind: 'skip' })),
  applySetupResult: vi.fn(async () => {}),
}));

import { handleDiscordMessageCreate } from '../index.js';

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
});
