import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import * as core from '@agent-im-relay/core';

function endSession(conversationId: string): boolean {
  const had = core.conversationSessions.has(conversationId);
  core.conversationSessions.delete(conversationId);
  core.activeConversations.delete(conversationId);
  if (had) void core.persistState();
  return had;
}

export const doneCommand = new SlashCommandBuilder()
  .setName('done')
  .setDescription('End the current Claude session in this thread')
  .setDMPermission(false);

export async function handleDoneCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel;
  if (!channel?.isThread()) {
    await interaction.reply({ content: 'This command only works inside a thread.', ephemeral: true });
    return;
  }

  const ended = endSession(channel.id);
  if (ended) {
    await interaction.reply('✅ Session ended. Start a new conversation by mentioning me again in a channel.');
    return;
  }

  await interaction.reply({ content: 'No active session in this thread.', ephemeral: true });
}
