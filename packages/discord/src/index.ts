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
import {
  conversationSessions,
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
import type { StreamTargetChannel } from './stream.js';
import { runMentionConversation } from './conversation.js';
import { collectMessageAttachments } from './files.js';
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

function extractMentionPrompt(content: string, botId: string): string {
  const mentionRegex = new RegExp(`<@!?${botId}>`, 'g');
  return content.replace(mentionRegex, '').replace(/\s+/g, ' ').trim();
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
): Promise<boolean> {
  return runMentionConversation(thread as AnyThreadChannel & StreamTargetChannel, prompt, triggerMsg, {
    attachments: collectMessageAttachments(triggerMsg),
    persist: persistState,
    setReaction,
  });
}

// --- Event handlers ---

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`Received ${signal}. Shutting down...`);
  client.destroy();
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
  if (message.author.bot || !message.inGuild()) return;

  const botUser = client.user;
  if (!botUser) return;

  const isExplicitMention = new RegExp(`<@!?${botUser.id}>`).test(message.content);
  const isActiveThread = message.channel.isThread() && conversationSessions.has(message.channel.id);

  if (!isExplicitMention && !isActiveThread) return;

  // Dedup guard
  if (processedMessages.has(message.id)) return;
  processedMessages.add(message.id);
  setTimeout(() => processedMessages.delete(message.id), 60_000);

  const prompt = isExplicitMention
    ? extractMentionPrompt(message.content, botUser.id)
    : message.content.trim();

  if (!prompt) {
    await message.reply('Please include a prompt after mentioning me.');
    return;
  }

  // React immediately to acknowledge
  await message.react(REACTIONS.received).catch(() => {});

  try {
    if (message.channel.isThread()) {
      await runThreadConversation(message.channel, prompt, message);
      return;
    }

    if (pendingConversationCreation.has(message.id)) return;
    pendingConversationCreation.add(message.id);

    try {
      const thread = await ensureMentionThread(message, prompt);
      await thread.send(`**${message.author.displayName}:** ${prompt}`);

      // Show backend setup only if backend not yet chosen
      if (!conversationBackend.has(thread.id)) {
        const result = await promptThreadSetup(thread, prompt);
        await applySetupResult(thread.id, result);
      }

      await runThreadConversation(thread, prompt, message);
    } finally {
      pendingConversationCreation.delete(message.id);
    }
  } catch (error) {
    const errorText = toErrorMessage(error);
    if (message.channel.isThread()) {
      await message.channel.send(`❌ ${errorText}`).catch(() => {});
    } else {
      await message.reply(`❌ ${errorText}`).catch(() => {});
    }
  }
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

await initState();
console.log(`[discord] adapter: ${adapter.name}`);
void client.login(config.discordToken);
