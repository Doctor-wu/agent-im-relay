import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import * as core from '@agent-im-relay/core';

export const doneCommand = new SlashCommandBuilder()
  .setName('done')
  .setDescription('End the current agent session in this thread')
  .setDMPermission(false);

export async function handleDoneCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel;
  if (!channel?.isThread()) {
    await interaction.reply({ content: 'This command only works inside a thread.', ephemeral: true });
    return;
  }

  const result = core.applySessionControlCommand({
    conversationId: channel.id,
    type: 'done',
  });

  if (result.persist) {
    void core.persistState('discord');
  }

  if (result.clearContinuation) {
    await interaction.reply('✅ Session ended. Start a new conversation by mentioning me again in a channel.');
    return;
  }

  await interaction.reply({ content: 'No active session in this thread.', ephemeral: true });
}
