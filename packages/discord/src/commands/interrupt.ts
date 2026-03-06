import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { interruptConversationRun } from '@agent-im-relay/core';

export const interruptCommand = new SlashCommandBuilder()
  .setName('interrupt')
  .setDescription('Interrupt the currently running agent task in this thread')
  .setDMPermission(false);

export async function handleInterruptCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel;
  if (!channel?.isThread()) {
    await interaction.reply({ content: '此命令只能在会话线程中使用。', ephemeral: true });
    return;
  }

  const interrupted = interruptConversationRun(channel.id);
  if (interrupted) {
    await interaction.reply({ content: '⏹️ 已请求中断当前任务。', ephemeral: true });
    return;
  }

  await interaction.reply({ content: '当前没有正在执行的任务。', ephemeral: true });
}
