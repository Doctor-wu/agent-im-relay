import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ComponentType,
  type AnyThreadChannel,
  type ChatInputCommandInteraction,
  type Message,
} from 'discord.js';
import {
  streamAgentSession,
  type AgentStreamEvent,
  conversationSessions,
  conversationModels,
  conversationEffort,
  conversationCwd,
  savedCwdList,
  activeConversations,
  processedMessages,
  pendingConversationCreation,
  persistState,
} from '@agent-im-relay/core';
import { config } from '../config.js';
import { streamAgentToDiscord, type StreamTargetChannel } from '../stream.js';

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
  .setDescription('工作目录管理')
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('set')
      .setDescription('设置当前 thread 的工作目录')
      .addStringOption((o) => o.setName('path').setDescription('绝对路径').setRequired(true)),
  )
  .addSubcommand((sub) => sub.setName('list').setDescription('列出常用目录'))
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('添加常用目录')
      .addStringOption((o) => o.setName('path').setDescription('绝对路径').setRequired(true)),
  )
  .addSubcommand((sub) => sub.setName('remove').setDescription('移除常用目录（交互式）'));

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

  conversationModels.set(channel.id, model);
  void persistState();
  await interaction.reply({ content: `Set model to \`${model}\` for this thread.`, ephemeral: true });
}

async function handleEffortCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = await requireThread(interaction);
  if (!channel) return;

  const level = interaction.options.getString('level', true);
  conversationEffort.set(channel.id, level);
  void persistState();
  await interaction.reply({ content: `Set effort to \`${level}\` for this thread.`, ephemeral: true });
}

async function handleCwdCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === 'set') {
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

    conversationCwd.set(channel.id, resolvedPath);
    void persistState();
    await interaction.reply({ content: `✅ 工作目录设置为：\`${resolvedPath}\``, ephemeral: true });
    return;
  }

  if (sub === 'list') {
    const list = savedCwdList.length
      ? savedCwdList.map((d, i) => `${i + 1}. \`${d}\``).join('\n')
      : '（空）';
    await interaction.reply({ content: `**常用目录：**\n${list}`, ephemeral: true });
    return;
  }

  if (sub === 'add') {
    const inputPath = interaction.options.getString('path', true).trim();
    if (!savedCwdList.includes(inputPath)) {
      savedCwdList.push(inputPath);
      void persistState();
      await interaction.reply({ content: `✅ 已添加：\`${inputPath}\``, ephemeral: true });
    } else {
      await interaction.reply({ content: `已存在：\`${inputPath}\``, ephemeral: true });
    }
    return;
  }

  if (sub === 'remove') {
    if (savedCwdList.length === 0) {
      await interaction.reply({ content: '常用目录为空。', ephemeral: true });
      return;
    }
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('cwd_remove_select')
        .setPlaceholder('选择要移除的目录')
        .addOptions(savedCwdList.map((d) => new StringSelectMenuOptionBuilder().setLabel(d).setValue(d))),
    );
    await interaction.reply({ content: '选择要移除的目录：', components: [row], ephemeral: true });

    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 30_000, max: 1 });
    collector.on('collect', async (i) => {
      const toRemove = i.values[0];
      const idx = savedCwdList.indexOf(toRemove);
      if (idx !== -1) savedCwdList.splice(idx, 1);
      void persistState();
      await i.update({ content: `✅ 已移除：\`${toRemove}\``, components: [] });
    });
  }
}

async function handleResumeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = await requireThread(interaction);
  if (!channel) return;

  const sessionId = interaction.options.getString('session_id', true).trim();
  if (!sessionId) {
    await interaction.reply({ content: 'Please provide a session ID.', ephemeral: true });
    return;
  }

  conversationSessions.set(channel.id, sessionId);
  void persistState();
  await interaction.reply({ content: `Set session to \`${sessionId}\` for this thread.`, ephemeral: true });
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

async function handleClearCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = await requireThread(interaction);
  if (!channel) return;

  const conversationId = channel.id;
  const removed =
    conversationSessions.delete(conversationId) ||
    conversationModels.delete(conversationId) ||
    conversationEffort.delete(conversationId) ||
    conversationCwd.delete(conversationId) ||
    activeConversations.delete(conversationId) ||
    processedMessages.delete(conversationId) ||
    pendingConversationCreation.delete(conversationId);

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

  if (activeConversations.has(channel.id)) {
    await interaction.reply({ content: 'A Claude run is already active in this thread.', ephemeral: true });
    return;
  }

  await interaction.deferReply();
  activeConversations.add(channel.id);

  try {
    await interaction.editReply(`## /compact\n${compactPrompt}\n\nThinking…`);
    const initialMessage = await interaction.fetchReply();

    const existingSessionId = conversationSessions.get(channel.id);
    const isResume = !!existingSessionId;
    const sessionId = existingSessionId ?? randomUUID();
    conversationSessions.set(channel.id, sessionId);

    let resolvedSessionId = sessionId;

    const events = streamAgentSession({
      mode: 'code',
      prompt: compactPrompt,
      model: conversationModels.get(channel.id),
      effort: conversationEffort.get(channel.id),
      cwd: conversationCwd.get(channel.id) ?? config.claudeCwd,
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

    conversationSessions.set(channel.id, resolvedSessionId);
    void persistState();
  } catch (error) {
    const errorText = toErrorMessage(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(`Failed to run /compact: ${errorText}`);
    } else {
      await interaction.reply({ content: `Failed to run /compact: ${errorText}`, ephemeral: true });
    }
  } finally {
    activeConversations.delete(channel.id);
  }
}
