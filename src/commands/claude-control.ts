import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  SlashCommandBuilder,
  type AnyThreadChannel,
  type ChatInputCommandInteraction,
  type Message,
} from 'discord.js';
import { streamAgentSession, type AgentStreamEvent } from '../agent/session.js';
import { config } from '../config.js';
import { streamAgentToDiscord, type StreamTargetChannel } from '../discord/stream.js';
import {
  activeThreads,
  pendingThreadCreation,
  persistState,
  processedMessages,
  threadCwd,
  threadEffort,
  threadModels,
  threadSessions,
} from '../state.js';

type CommandHandler = (interaction: ChatInputCommandInteraction) => Promise<void>;

const compactPrompt = 'Summarize our conversation and current task state briefly.';

export const modelCommand = new SlashCommandBuilder()
  .setName('model')
  .setDescription('Set Claude model for this thread')
  .setDMPermission(false)
  .addStringOption((option) => option.setName('model').setDescription('Claude model name').setRequired(true));

export const effortCommand = new SlashCommandBuilder()
  .setName('effort')
  .setDescription('Set Claude effort for this thread')
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('level')
      .setDescription('Effort level')
      .setRequired(true)
      .addChoices(
        { name: 'low', value: 'low' },
        { name: 'medium', value: 'medium' },
        { name: 'high', value: 'high' },
      ),
  );

export const cwdCommand = new SlashCommandBuilder()
  .setName('cwd')
  .setDescription('Set Claude working directory for this thread')
  .setDMPermission(false)
  .addStringOption((option) => option.setName('path').setDescription('Absolute or relative path').setRequired(true));

export const resumeCommand = new SlashCommandBuilder()
  .setName('resume')
  .setDescription('Set the Claude session ID to resume in this thread')
  .setDMPermission(false)
  .addStringOption((option) =>
    option.setName('session_id').setDescription('Claude session ID').setRequired(true),
  );

export const sessionsCommand = new SlashCommandBuilder()
  .setName('sessions')
  .setDescription('List active Claude sessions')
  .setDMPermission(false);

export const clearCommand = new SlashCommandBuilder()
  .setName('clear')
  .setDescription('Clear all saved Claude state for this thread')
  .setDMPermission(false);

export const compactCommand = new SlashCommandBuilder()
  .setName('compact')
  .setDescription('Ask Claude to summarize this thread context briefly')
  .setDMPermission(false);

export const claudeControlCommands = [
  modelCommand,
  effortCommand,
  cwdCommand,
  resumeCommand,
  sessionsCommand,
  clearCommand,
  compactCommand,
];

export const claudeControlCommandHandlers = new Map<string, CommandHandler>([
  ['model', handleModelCommand],
  ['effort', handleEffortCommand],
  ['cwd', handleCwdCommand],
  ['resume', handleResumeCommand],
  ['sessions', handleSessionsCommand],
  ['clear', handleClearCommand],
  ['compact', handleCompactCommand],
]);

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function requireThread(
  interaction: ChatInputCommandInteraction,
): Promise<AnyThreadChannel | null> {
  const channel = interaction.channel;
  if (!channel?.isThread()) {
    await interaction.reply({ content: 'This command only works inside a thread.', ephemeral: true });
    return null;
  }

  return channel;
}

function threadSessionSummary(threadId: string, sessionId: string): string {
  const model = threadModels.get(threadId);
  const effort = threadEffort.get(threadId);
  const cwd = threadCwd.get(threadId);
  const extras = [
    model ? `model=${model}` : '',
    effort ? `effort=${effort}` : '',
    cwd ? `cwd=${cwd}` : '',
  ].filter(Boolean);

  return extras.length > 0
    ? `- <#${threadId}>: \`${sessionId}\` (${extras.join(', ')})`
    : `- <#${threadId}>: \`${sessionId}\``;
}

async function handleModelCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = await requireThread(interaction);
  if (!channel) return;

  const model = interaction.options.getString('model', true).trim();
  if (!model) {
    await interaction.reply({ content: 'Please provide a model name.', ephemeral: true });
    return;
  }

  threadModels.set(channel.id, model);
  void persistState();
  await interaction.reply({ content: `Set model to \`${model}\` for this thread.`, ephemeral: true });
}

async function handleEffortCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = await requireThread(interaction);
  if (!channel) return;

  const level = interaction.options.getString('level', true);
  threadEffort.set(channel.id, level);
  void persistState();
  await interaction.reply({ content: `Set effort to \`${level}\` for this thread.`, ephemeral: true });
}

async function handleCwdCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = await requireThread(interaction);
  if (!channel) return;

  const inputPath = interaction.options.getString('path', true).trim();
  if (!inputPath) {
    await interaction.reply({ content: 'Please provide a path.', ephemeral: true });
    return;
  }

  const resolvedPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);
  if (!existsSync(resolvedPath)) {
    await interaction.reply({ content: `Path does not exist: \`${resolvedPath}\``, ephemeral: true });
    return;
  }

  threadCwd.set(channel.id, resolvedPath);
  void persistState();
  await interaction.reply({ content: `Set working directory to \`${resolvedPath}\`.`, ephemeral: true });
}

async function handleResumeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = await requireThread(interaction);
  if (!channel) return;

  const sessionId = interaction.options.getString('session_id', true).trim();
  if (!sessionId) {
    await interaction.reply({ content: 'Please provide a session ID.', ephemeral: true });
    return;
  }

  threadSessions.set(channel.id, sessionId);
  void persistState();
  await interaction.reply({ content: `Set session to \`${sessionId}\` for this thread.`, ephemeral: true });
}

async function handleSessionsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (threadSessions.size === 0) {
    await interaction.reply({ content: 'No active sessions.', ephemeral: true });
    return;
  }

  const lines = [...threadSessions.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([threadId, sessionId]) => threadSessionSummary(threadId, sessionId));

  await interaction.reply({
    content: `Active sessions (${threadSessions.size}):\n${lines.join('\n')}`,
    ephemeral: true,
  });
}

async function handleClearCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = await requireThread(interaction);
  if (!channel) return;

  const threadId = channel.id;
  const removed =
    threadSessions.delete(threadId) ||
    threadModels.delete(threadId) ||
    threadEffort.delete(threadId) ||
    threadCwd.delete(threadId) ||
    activeThreads.delete(threadId) ||
    processedMessages.delete(threadId) ||
    pendingThreadCreation.delete(threadId);

  if (removed) {
    void persistState();
    await interaction.reply({ content: 'Cleared Claude state for this thread.', ephemeral: true });
    return;
  }

  await interaction.reply({ content: 'No saved Claude state found for this thread.', ephemeral: true });
}

async function* captureSessionEvents(
  events: AsyncIterable<AgentStreamEvent>,
  onEvent: (event: AgentStreamEvent) => void,
): AsyncGenerator<AgentStreamEvent, void> {
  for await (const event of events) {
    onEvent(event);
    yield event;
  }
}

async function handleCompactCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = await requireThread(interaction);
  if (!channel) return;

  if (activeThreads.has(channel.id)) {
    await interaction.reply({ content: 'A Claude run is already active in this thread.', ephemeral: true });
    return;
  }

  await interaction.deferReply();
  activeThreads.add(channel.id);

  try {
    await interaction.editReply(`## /compact\n${compactPrompt}\n\nThinking…`);
    const initialMessage = await interaction.fetchReply();

    const existingSessionId = threadSessions.get(channel.id);
    const isResume = !!existingSessionId;
    const sessionId = existingSessionId ?? randomUUID();
    threadSessions.set(channel.id, sessionId);

    let resolvedSessionId = sessionId;

    const events = streamAgentSession({
      mode: 'code',
      prompt: compactPrompt,
      model: threadModels.get(channel.id),
      effort: threadEffort.get(channel.id),
      cwd: threadCwd.get(channel.id) ?? config.claudeCwd,
      ...(isResume ? { resumeSessionId: sessionId } : { sessionId }),
    });

    await streamAgentToDiscord(
      {
        channel: channel as StreamTargetChannel,
        initialMessage: initialMessage as Message<boolean>,
      },
      captureSessionEvents(events, (event) => {
        if (event.type === 'done' && event.sessionId) {
          resolvedSessionId = event.sessionId;
        }
      }),
    );

    threadSessions.set(channel.id, resolvedSessionId);
    void persistState();
  } catch (error) {
    const errorText = toErrorMessage(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(`Failed to run /compact: ${errorText}`);
    } else {
      await interaction.reply({ content: `Failed to run /compact: ${errorText}`, ephemeral: true });
    }
  } finally {
    activeThreads.delete(channel.id);
  }
}
