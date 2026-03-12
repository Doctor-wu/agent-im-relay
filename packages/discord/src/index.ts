import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  type AutocompleteInteraction,
  type AnyThreadChannel,
  type ChatInputCommandInteraction,
  type Message,
} from 'discord.js';
import { fileURLToPath } from 'node:url';
import {
  applyMessageControlDirectives,
  conversationBackend,
  conversationModels,
  activeConversations,
  getAvailableBackendCapabilities,
  processedMessages,
  pendingConversationCreation,
  persistState,
  initState,
  listSkills,
  Orchestrator,
  type IncomingMessage,
  preprocessConversationMessage,
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
import { statusCommand, handleStatusCommand } from './commands/status.js';
import { agentControlCommandHandlers, agentControlCommands } from './commands/agent-control.js';
import {
  handleSkillAutocomplete,
  handleSkillCommand,
  skillCommand,
} from './commands/skill.js';
import { promptThreadSetup, applySetupResult } from './commands/thread-setup.js';

type CommandHandler = (interaction: ChatInputCommandInteraction) => Promise<void>;
type AutocompleteHandler = (interaction: AutocompleteInteraction) => Promise<void>;

// --- Command registry ---
const commandHandlers = new Map<string, CommandHandler>([
  ['code', handleCodeCommand],
  ['ask', handleAskCommand],
  ['interrupt', handleInterruptCommand],
  ['skill', handleSkillCommand],
  ['done', handleDoneCommand],
  ['status', handleStatusCommand],
  ...agentControlCommandHandlers.entries(),
]);

const autocompleteHandlers = new Map<string, AutocompleteHandler>([
  ['skill', handleSkillAutocomplete],
]);

const commandDefinitions = [
  codeCommand,
  askCommand,
  interruptCommand,
  skillCommand,
  doneCommand,
  statusCommand,
  ...agentControlCommands,
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

async function persistDiscordMessageControls(
  conversationId: string,
  directives: ReturnType<typeof preprocessConversationMessage>['directives'],
): Promise<void> {
  const results = applyMessageControlDirectives({ conversationId, directives });
  if (results.some(result => result.persist)) {
    await persistState('discord');
  }
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

  const preprocessed = preprocessConversationMessage(routedMessage.prompt);
  const prompt = preprocessed.prompt;

  // React immediately to acknowledge
  await message.react(REACTIONS.received).catch(() => {});

  try {
    if (message.channel.isThread()) {
      await persistDiscordMessageControls(message.channel.id, preprocessed.directives);
      if (!prompt) {
        if (preprocessed.directives.length === 0) {
          await message.channel.send(
            buildDiscordReplyPayload('Please include a prompt after mentioning me.', replyContext),
          ).catch(() => {});
        }
        return;
      }

      await (dependencies.runThreadConversation ?? runThreadConversation)(
        message.channel,
        prompt,
        message,
        replyContext,
      );
      return;
    }

    if (!prompt && preprocessed.directives.length === 0) {
      await message.channel.send(
        buildDiscordReplyPayload('Please include a prompt after mentioning me.', replyContext),
      ).catch(() => {});
      return;
    }

    if (pendingConversationCreation.has(message.id)) return;
    pendingConversationCreation.add(message.id);

    try {
      const thread = await (dependencies.ensureMentionThread ?? ensureMentionThread)(message as Message<true>, prompt);
      if (prompt) {
        await thread.send(`**${message.author.displayName}:** ${prompt}`);
      }
      await persistDiscordMessageControls(thread.id, preprocessed.directives);

      if (!prompt) {
        return;
      }

      const configuredBackend = conversationBackend.get(thread.id);
      const hasModel = conversationModels.has(thread.id);
      let requiresModelSetup = false;

      if (configuredBackend && !hasModel) {
        const capabilities = await getAvailableBackendCapabilities();
        const backendCapability = capabilities.find(backend => backend.name === configuredBackend);
        requiresModelSetup = Boolean(backendCapability && backendCapability.models.length > 0);
      }

      if (!configuredBackend || requiresModelSetup) {
        const result = await (dependencies.promptThreadSetup ?? promptThreadSetup)(
          thread,
          prompt,
          configuredBackend ? { presetBackend: configuredBackend } : undefined,
        );
        if (!result) {
          return;
        }
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
    console.log(`Loaded ${skills.length} agent skill(s).`);
  } catch (error) {
    console.warn(`Failed to load agent skills: ${toErrorMessage(error)}`);
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

    if (interaction.isAutocomplete()) {
      const handler = autocompleteHandlers.get(interaction.commandName);
      if (!handler) return;

      await handler(interaction);
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
