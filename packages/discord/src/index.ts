import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type AnyThreadChannel,
  type ChatInputCommandInteraction,
  type Message,
} from 'discord.js';
import { fileURLToPath } from 'node:url';
import {
  conversationBackend,
  activeConversations,
  processedMessages,
  pendingConversationCreation,
  persistState,
  initState,
  listSkills,
  Orchestrator,
  type IncomingMessage,
} from '@agent-im-relay/core';
import { config } from './config.js';
import { createDiscordAdapter } from './adapter.js';
import { buildDiscordReplyPayload, createDiscordReplyContext, type DiscordReplyContext } from './reply-context.js';
import type { StreamTargetChannel } from './stream.js';
import { hasOpenStickyThreadSession, runMentionConversation } from './conversation.js';
import { collectMessageAttachments } from './files.js';
import { resolveInboundDiscordMessage } from './message-routing.js';
import { ensureMentionThread } from './thread.js';
import { askCommand, handleAskCommand } from './commands/ask.js';
import { codeCommand, handleCodeCommand } from './commands/code.js';
import { doneCommand, handleDoneCommand } from './commands/done.js';
import { interruptCommand, handleInterruptCommand } from './commands/interrupt.js';
import { claudeControlCommandHandlers, claudeControlCommands } from './commands/claude-control.js';
import {
  handleSkillCommand,
  handleSkillModalSubmit,
  handleSkillSelectMenu,
  skillCommand,
  SKILL_MODAL_CUSTOM_ID_PREFIX,
  SKILL_SELECT_CUSTOM_ID,
} from './commands/skill.js';
import { promptThreadSetup, applySetupResult } from './commands/thread-setup.js';

type CommandHandler = (interaction: ChatInputCommandInteraction) => Promise<void>;

// --- Command registry ---
const commandHandlers = new Map<string, CommandHandler>([
  ['code', handleCodeCommand],
  ['ask', handleAskCommand],
  ['interrupt', handleInterruptCommand],
  ['skill', handleSkillCommand],
  ['done', handleDoneCommand],
  ...claudeControlCommandHandlers.entries(),
]);

const commandDefinitions = [
  codeCommand,
  askCommand,
  interruptCommand,
  skillCommand,
  doneCommand,
  ...claudeControlCommands,
];

// --- Client ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const rest = new REST({ version: '10' }).setToken(config.discordToken);
const adapter = createDiscordAdapter(client);
const _orchestrator = new Orchestrator({ flushIntervalMs: config.streamUpdateIntervalMs });
let initialized = false;
let processHandlersRegistered = false;

async function registerSlashCommands(): Promise<void> {
  const body = commandDefinitions.map((command) => command.toJSON());

  if (config.guildIds.length > 0) {
    await Promise.all(
      config.guildIds.map(async (guildId) => {
        await rest.put(Routes.applicationGuildCommands(config.discordClientId, guildId), { body });
      }),
    );
    console.log(`Registered slash commands for ${config.guildIds.length} guild(s).`);
    return;
  }

  await rest.put(Routes.applicationCommands(config.discordClientId), { body });
  console.log('Registered global slash commands.');
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// --- Reaction status indicator ---
const REACTIONS = { received: '👀', thinking: '🧠', tools: '🔧', done: '✅', error: '❌' } as const;
type ReactionPhase = keyof typeof REACTIONS;

async function setReaction(msg: Message, phase: ReactionPhase, currentPhase?: ReactionPhase): Promise<void> {
  try {
    if (currentPhase && currentPhase !== phase) {
      await msg.reactions.cache.get(REACTIONS[currentPhase])?.users.remove(msg.client.user!.id).catch(() => {});
    }
    await msg.react(REACTIONS[phase]);
  } catch {
    // Silently ignore reaction failures
  }
}

async function runThreadConversation(
  thread: AnyThreadChannel,
  prompt: string,
  triggerMsg?: Message,
  replyContext?: DiscordReplyContext,
): Promise<boolean> {
  return runMentionConversation(thread as AnyThreadChannel & StreamTargetChannel, prompt, triggerMsg, {
    attachments: collectMessageAttachments(triggerMsg),
    persist: () => persistState('discord'),
    replyContext,
    setReaction,
  });
}

type HandleDiscordMessageCreateDependencies = {
  botUser?: { id: string };
  hasOpenStickyThreadSession?: (conversationId: string) => boolean;
  runThreadConversation?: (
    thread: AnyThreadChannel,
    prompt: string,
    triggerMsg?: Message,
    replyContext?: DiscordReplyContext,
  ) => Promise<boolean>;
  ensureMentionThread?: typeof ensureMentionThread;
  promptThreadSetup?: typeof promptThreadSetup;
  applySetupResult?: typeof applySetupResult;
};

export async function handleDiscordMessageCreate(
  message: Message,
  dependencies: HandleDiscordMessageCreateDependencies = {},
): Promise<void> {
  const botUser = dependencies.botUser ?? client.user;
  if (!botUser) return;

  const isActiveThread = message.channel.isThread()
    && (dependencies.hasOpenStickyThreadSession ?? hasOpenStickyThreadSession)(message.channel.id);
  const routedMessage = resolveInboundDiscordMessage({
    relayBotId: botUser.id,
    authorId: message.author.id,
    authorBot: message.author.bot,
    content: message.content,
    inGuild: message.inGuild(),
    inActiveThread: isActiveThread,
  });
  if (!routedMessage.accepted) return;

  const replyContext = createDiscordReplyContext({
    relayBotId: botUser.id,
    authorId: message.author.id,
    authorBot: message.author.bot,
  });

  // Dedup guard
  if (processedMessages.has(message.id)) return;
  processedMessages.add(message.id);
  setTimeout(() => processedMessages.delete(message.id), 60_000);

  const prompt = routedMessage.prompt;

  if (!prompt) {
    await message.channel.send(
      buildDiscordReplyPayload('Please include a prompt after mentioning me.', replyContext),
    ).catch(() => {});
    return;
  }

  // React immediately to acknowledge
  await message.react(REACTIONS.received).catch(() => {});

  try {
    if (message.channel.isThread()) {
      await (dependencies.runThreadConversation ?? runThreadConversation)(
        message.channel,
        prompt,
        message,
        replyContext,
      );
      return;
    }

    if (pendingConversationCreation.has(message.id)) return;
    pendingConversationCreation.add(message.id);

    try {
      const thread = await (dependencies.ensureMentionThread ?? ensureMentionThread)(message as Message<true>, prompt);
      await thread.send(`**${message.author.displayName}:** ${prompt}`);

      // Show backend setup only if backend not yet chosen
      if (!conversationBackend.has(thread.id)) {
        const result = await (dependencies.promptThreadSetup ?? promptThreadSetup)(thread, prompt);
        await (dependencies.applySetupResult ?? applySetupResult)(thread.id, result);
      }

      await (dependencies.runThreadConversation ?? runThreadConversation)(
        thread,
        prompt,
        message,
        replyContext,
      );
    } finally {
      pendingConversationCreation.delete(message.id);
    }
  } catch (error) {
    const errorText = toErrorMessage(error);
    await message.channel.send(buildDiscordReplyPayload(`❌ ${errorText}`, replyContext)).catch(() => {});
  }
}

// --- Event handlers ---

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`Received ${signal}. Shutting down...`);
  client.destroy();
  initialized = false;
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  await registerSlashCommands();

  try {
    const skills = await listSkills();
    console.log(`Loaded ${skills.length} Claude skill(s).`);
  } catch (error) {
    console.warn(`Failed to load Claude skills: ${toErrorMessage(error)}`);
  }
});

client.rest.on('rateLimited', (rateLimitData) => {
  console.warn(`Discord rate limit hit on ${rateLimitData.route}`);
});

client.on(Events.Error, (error) => {
  console.error('Discord client error:', error);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const handler = commandHandlers.get(interaction.commandName);
      if (!handler) return;

      await handler(interaction);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === SKILL_SELECT_CUSTOM_ID) {
      await handleSkillSelectMenu(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(SKILL_MODAL_CUSTOM_ID_PREFIX)) {
      await handleSkillModalSubmit(interaction, runThreadConversation);
    }
  } catch (error) {
    const errorText = toErrorMessage(error);
    if ('replied' in interaction && 'reply' in interaction) {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: `Unexpected error: ${errorText}`, ephemeral: true });
      } else {
        await interaction.reply({ content: `Unexpected error: ${errorText}`, ephemeral: true });
      }
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  await handleDiscordMessageCreate(message);
});

function registerProcessHandlers(): void {
  if (processHandlersRegistered) {
    return;
  }

  processHandlersRegistered = true;

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
  });
}

function isMainModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return fileURLToPath(import.meta.url) === process.argv[1];
}

export async function startDiscordRuntime(): Promise<Client> {
  registerProcessHandlers();

  if (!initialized) {
    await initState('discord');
    initialized = true;
  }

  if (!client.isReady()) {
    console.log(`[discord] adapter: ${adapter.name}`);
    await client.login(config.discordToken);
  }

  return client;
}

if (isMainModule()) {
  void startDiscordRuntime().catch((error) => {
    console.error('[discord] failed to start:', error);
    process.exitCode = 1;
  });
}
