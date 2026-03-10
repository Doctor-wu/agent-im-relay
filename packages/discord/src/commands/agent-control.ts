import {
  SlashCommandBuilder,
  type AnyThreadChannel,
  type ChatInputCommandInteraction,
  type Message,
} from 'discord.js';
import * as core from '@agent-im-relay/core';
import {
  runPlatformConversation,
  conversationBackend,
  conversationSessions,
  conversationModels,
  conversationEffort,
  conversationCwd,
  activeConversations,
} from '@agent-im-relay/core';
import { config } from '../config.js';
import { streamAgentToDiscord, type StreamTargetChannel } from '../stream.js';

type CommandHandler = (interaction: ChatInputCommandInteraction) => Promise<void>;

const compactPrompt = 'Summarize our conversation and current task state briefly.';

export const modelCommand = new SlashCommandBuilder()
  .setName('model')
  .setDescription('Set agent model for this thread')
  .setDMPermission(false)
  .addStringOption((option) => option.setName('model').setDescription('Agent model name').setRequired(true));

export const effortCommand = new SlashCommandBuilder()
  .setName('effort')
  .setDescription('Set agent effort for this thread')
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

export const sessionsCommand = new SlashCommandBuilder()
  .setName('sessions')
  .setDescription('List active agent sessions')
  .setDMPermission(false);

export const cwdCommand = new SlashCommandBuilder()
  .setName('cwd')
  .setDescription('Manage working directory overrides for this thread')
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('set')
      .setDescription('Set a working directory override for this thread')
      .addStringOption((option) =>
        option.setName('path').setDescription('Absolute working directory path').setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('clear')
      .setDescription('Clear the working directory override for this thread'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('show')
      .setDescription('Show the current working directory configuration for this thread'),
  );

export const compactCommand = new SlashCommandBuilder()
  .setName('compact')
  .setDescription('Ask agent to summarize this thread context briefly')
  .setDMPermission(false);

export const agentControlCommands = [
  modelCommand,
  effortCommand,
  sessionsCommand,
  cwdCommand,
  compactCommand,
];

export const agentControlCommandHandlers = new Map<string, CommandHandler>([
  ['model', handleModelCommand],
  ['effort', handleEffortCommand],
  ['sessions', handleSessionsCommand],
  ['cwd', handleCwdCommand],
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

function conversationSessionSummary(conversationId: string, sessionId: string): string {
  const model = conversationModels.get(conversationId);
  const effort = conversationEffort.get(conversationId);
  const cwd = conversationCwd.get(conversationId);
  const extras = [
    model ? `model=${model}` : '',
    effort ? `effort=${effort}` : '',
    cwd ? `cwd=${cwd}` : '',
  ].filter(Boolean);

  return extras.length > 0
    ? `- <#${conversationId}>: \`${sessionId}\` (${extras.join(', ')})`
    : `- <#${conversationId}>: \`${sessionId}\``;
}

async function handleModelCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = await requireThread(interaction);
  if (!channel) return;

  const model = interaction.options.getString('model', true).trim();
  if (!model) {
    await interaction.reply({ content: 'Please provide a model name.', ephemeral: true });
    return;
  }

  const result = core.applySessionControlCommand({
    conversationId: channel.id,
    type: 'model',
    value: model,
  });
  if (result.persist) {
    void core.persistState('discord');
  }
  await interaction.reply({ content: `Set model to \`${model}\` for this thread.`, ephemeral: true });
}

async function handleEffortCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = await requireThread(interaction);
  if (!channel) return;

  const level = interaction.options.getString('level', true);
  const result = core.applySessionControlCommand({
    conversationId: channel.id,
    type: 'effort',
    value: level,
  });
  if (result.persist) {
    void core.persistState('discord');
  }
  await interaction.reply({ content: `Set effort to \`${level}\` for this thread.`, ephemeral: true });
}

async function handleSessionsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (conversationSessions.size === 0) {
    await interaction.reply({ content: 'No active sessions.', ephemeral: true });
    return;
  }

  const lines = [...conversationSessions.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([conversationId, sessionId]) => conversationSessionSummary(conversationId, sessionId));

  await interaction.reply({
    content: `Active sessions (${conversationSessions.size}):\n${lines.join('\n')}`,
    ephemeral: true,
  });
}

function formatConfiguredEnvironment(threadId: string): string {
  const backend = conversationBackend.get(threadId) ?? 'claude';
  const model = conversationModels.get(threadId) ?? 'backend default';
  const cwd = conversationCwd.get(threadId);
  const cwdText = cwd ? `${cwd} (manual override)` : 'auto-detected by backend';

  return [
    '## Environment',
    `- Backend: ${backend}`,
    `- Model: ${model}`,
    `- Working directory: ${cwdText}`,
  ].join('\n');
}

async function handleCwdCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = await requireThread(interaction);
  if (!channel) return;

  const subcommand = interaction.options.getSubcommand(true);

  if (subcommand === 'set') {
    const path = interaction.options.getString('path', true).trim();
    if (!path) {
      await interaction.reply({ content: 'Please provide a working directory path.', ephemeral: true });
      return;
    }

    conversationCwd.set(channel.id, path);
    void core.persistState('discord');
    await interaction.reply({
      content: `Set working directory override to \`${path}\` for this thread.`,
      ephemeral: true,
    });
    return;
  }

  if (subcommand === 'clear') {
    const removed = conversationCwd.delete(channel.id);
    if (removed) {
      void core.persistState('discord');
      await interaction.reply({
        content: 'Cleared the working directory override. Future runs will auto-detect it.',
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: 'No working directory override is set for this thread.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: formatConfiguredEnvironment(channel.id),
    ephemeral: true,
  });
}

async function handleCompactCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = await requireThread(interaction);
  if (!channel) return;

  if (activeConversations.has(channel.id)) {
    await interaction.reply({ content: 'An agent run is already active in this thread.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    await interaction.editReply(`## /compact\n${compactPrompt}\n\nThinking…`);
    const initialMessage = await interaction.fetchReply();
    const started = await runPlatformConversation({
      conversationId: channel.id,
      target: channel as AnyThreadChannel & StreamTargetChannel,
      prompt: compactPrompt,
      mode: 'code',
      backend: conversationBackend.get(channel.id),
      defaultCwd: config.claudeCwd,
      persist: () => core.persistState('discord'),
      render: ({ target, showEnvironment }, events) => streamAgentToDiscord(
        {
          channel: target,
          initialMessage: initialMessage as Message<boolean>,
          showEnvironment,
        },
        events,
      ),
    });

    if (!started) {
      await interaction.editReply('An agent run is already active in this thread.');
    }
  } catch (error) {
    const errorText = toErrorMessage(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(`Failed to run /compact: ${errorText}`);
    } else {
      await interaction.reply({ content: `Failed to run /compact: ${errorText}`, ephemeral: true });
    }
  }
}
