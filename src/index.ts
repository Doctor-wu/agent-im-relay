import { randomUUID } from 'node:crypto';
import {
  type AnyThreadChannel,
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Message } from 'discord.js';
import { streamAgentSession, type AgentStreamEvent } from './agent/session.js';
import { config } from './config.js';
import { askCommand, handleAskCommand } from './commands/ask.js';
import { codeCommand, handleCodeCommand } from './commands/code.js';
import { streamAgentToDiscord, type StreamTargetChannel } from './discord/stream.js';
import { ensureMentionThread } from './discord/thread.js';

type CommandHandler = (interaction: ChatInputCommandInteraction) => Promise<void>;

// --- Session store ---
// Maps threadId → Claude Code session ID for --resume
const threadSessions = new Map<string, string>();

// Track active (in-progress) threads to prevent concurrent runs
const activeThreads = new Set<string>();

function endSession(threadId: string): boolean {
  const had = threadSessions.has(threadId);
  threadSessions.delete(threadId);
  activeThreads.delete(threadId);
  return had;
}

// --- /done command ---
const doneCommand = new SlashCommandBuilder()
  .setName('done')
  .setDescription('End the current Claude session in this thread')
  .setDMPermission(false);

async function handleDoneCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel;
  if (!channel?.isThread()) {
    await interaction.reply({ content: 'This command only works inside a thread.', ephemeral: true });
    return;
  }

  const ended = endSession(channel.id);
  if (ended) {
    await interaction.reply('✅ Session ended. Start a new conversation by mentioning me again in a channel.');
  } else {
    await interaction.reply({ content: 'No active session in this thread.', ephemeral: true });
  }
}

// --- Command registry ---
const commandHandlers = new Map<string, CommandHandler>([
  ['code', handleCodeCommand],
  ['ask', handleAskCommand],
  ['done', handleDoneCommand],
]);

const commandDefinitions = [codeCommand, askCommand, doneCommand];

// --- Client ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const rest = new REST({ version: '10' }).setToken(config.discordToken);

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

async function* captureAgentEvents(
  events: AsyncIterable<AgentStreamEvent>,
  onEvent: (event: AgentStreamEvent) => void,
): AsyncGenerator<AgentStreamEvent, void> {
  for await (const event of events) {
    onEvent(event);
    yield event;
  }
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

async function runMentionConversation(thread: AnyThreadChannel, prompt: string, triggerMsg?: Message): Promise<void> {
  if (activeThreads.has(thread.id)) {
    // Don't send a message — just silently ignore to avoid spam
    return;
  }

  activeThreads.add(thread.id);
  let phase = 'thinking' as ReactionPhase;
  if (triggerMsg) await setReaction(triggerMsg, 'thinking', 'received');

  try {
    const existingSessionId = threadSessions.get(thread.id);
    const isResume = !!existingSessionId;
    const sessionId = existingSessionId ?? randomUUID();

    // Store session ID immediately so follow-up messages know this thread is active
    threadSessions.set(thread.id, sessionId);

    console.log(`[session] thread=${thread.id} ${isResume ? 'resume' : 'new'} session=${sessionId}`);

    const events = streamAgentSession({
      mode: 'code',
      prompt,
      cwd: config.claudeCwd,
      ...(isResume
        ? { resumeSessionId: sessionId }
        : { sessionId }),
    });

    let resolvedSessionId = sessionId;

    await streamAgentToDiscord(
      { channel: thread as StreamTargetChannel },
      captureAgentEvents(events, (event) => {
        if (event.type === 'tool' && phase !== 'tools' && phase !== 'error') {
          const prev = phase;
          phase = 'tools';
          if (triggerMsg) void setReaction(triggerMsg, 'tools', prev);
        } else if (event.type === 'done') {
          // Claude CLI may return a different session_id than what we passed
          if (event.sessionId) resolvedSessionId = event.sessionId;
        } else if (event.type === 'error') {
          const prev = phase;
          phase = 'error';
          if (triggerMsg) void setReaction(triggerMsg, 'error', prev);
        }
      }),
    );

    if (phase !== 'error') {
      if (triggerMsg) await setReaction(triggerMsg, 'done', phase);
    }

    // Update with the resolved session ID from Claude CLI
    threadSessions.set(thread.id, resolvedSessionId);
  } catch (err) {
    if (triggerMsg) await setReaction(triggerMsg, 'error', phase);
    throw err;
  } finally {
    activeThreads.delete(thread.id);
  }
}

// --- Event handlers ---

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`Received ${signal}. Shutting down...`);
  client.destroy();
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  await registerSlashCommands();
});

client.rest.on('rateLimited', (rateLimitData) => {
  console.warn(`Discord rate limit hit on ${rateLimitData.route}`);
});

client.on(Events.Error, (error) => {
  console.error('Discord client error:', error);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const handler = commandHandlers.get(interaction.commandName);
  if (!handler) return;

  try {
    await handler(interaction);
  } catch (error) {
    const errorText = toErrorMessage(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: `Unexpected error: ${errorText}`, ephemeral: true });
    } else {
      await interaction.reply({ content: `Unexpected error: ${errorText}`, ephemeral: true });
    }
  }
});

// Dedup: track processed message IDs to prevent double-handling
const processedMessages = new Set<string>();
const pendingThreadCreation = new Set<string>();

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.inGuild()) return;

  const botUser = client.user;
  if (!botUser) return;

  const isExplicitMention = new RegExp(`<@!?${botUser.id}>`).test(message.content);
  const isActiveThread = message.channel.isThread() && threadSessions.has(message.channel.id);

  // In an active thread: respond to all messages (no @ needed)
  // In a channel: only respond to explicit @ mentions
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
      // Already in a thread — continue the session there
      await runMentionConversation(message.channel, prompt, message);
      return;
    }

    if (pendingThreadCreation.has(message.id)) return;
    pendingThreadCreation.add(message.id);

    try {
      // In a channel — create a new thread (= new session)
      const thread = await ensureMentionThread(message, prompt);
      // Echo the user's prompt in the thread for context
      await thread.send(`**${message.author.displayName}:** ${prompt}`);
      await runMentionConversation(thread, prompt, message);
    } finally {
      pendingThreadCreation.delete(message.id);
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

void client.login(config.discordToken);
