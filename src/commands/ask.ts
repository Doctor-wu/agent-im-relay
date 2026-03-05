import { SlashCommandBuilder, type ChatInputCommandInteraction, type Message } from 'discord.js';
import { streamAgentSession } from '../agent/session.js';
import { streamAgentToDiscord, type StreamTargetChannel } from '../discord/stream.js';

export const askCommand = new SlashCommandBuilder()
  .setName('ask')
  .setDescription('Ask Claude a quick question without file tools')
  .addStringOption((option) => option.setName('question').setDescription('Your question').setRequired(true));

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function handleAskCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const question = interaction.options.getString('question', true).trim();
  if (!question) {
    await interaction.reply({ content: 'Please provide a question.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    const channel = interaction.channel;
    if (!channel?.isTextBased() || !('send' in channel)) {
      throw new Error('Cannot stream /ask output in this channel type.');
    }

    await interaction.editReply(`## /ask\n${question}\n\nThinking…`);
    const initialMessage = await interaction.fetchReply();

    const events = streamAgentSession({
      mode: 'ask',
      prompt: question,
      cwd: process.cwd(),
    });

    await streamAgentToDiscord({
      channel: channel as StreamTargetChannel,
      initialMessage: initialMessage as Message<boolean>,
    }, events);
  } catch (error) {
    const errorText = toErrorMessage(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(`Failed to run /ask: ${errorText}`);
    } else {
      await interaction.reply({ content: `Failed to run /ask: ${errorText}`, ephemeral: true });
    }
  }
}
