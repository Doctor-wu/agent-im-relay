import { SlashCommandBuilder, type ChatInputCommandInteraction, type Message } from 'discord.js';
import { streamAgentSession } from '@agent-im-relay/core';
import { collectInteractionAttachments, prepareAttachmentPrompt } from '../files.js';
import { streamAgentToDiscord, type StreamTargetChannel } from '../stream.js';

export const askCommand = new SlashCommandBuilder()
  .setName('ask')
  .setDescription('Ask Agent a quick question without file tools')
  .addStringOption((option) => option.setName('question').setDescription('Your question').setRequired(true))
  .addAttachmentOption((option) =>
    option.setName('file').setDescription('Optional attachment to share with the agent'),
  )
  .addAttachmentOption((option) =>
    option.setName('file2').setDescription('Optional second attachment'),
  )
  .addAttachmentOption((option) =>
    option.setName('file3').setDescription('Optional third attachment'),
  );

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function handleAskCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const question = interaction.options.getString('question', true).trim();
  const attachments = collectInteractionAttachments(interaction.options);
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

    const preparedPrompt = await prepareAttachmentPrompt({
      conversationId: `ask-${interaction.id}`,
      prompt: question,
      attachments,
      sourceMessageId: interaction.id,
    });

    await interaction.editReply(`## /ask\n${question}\n\nThinking…`);
    const initialMessage = await interaction.fetchReply();

    const events = streamAgentSession({
      mode: 'ask',
      prompt: preparedPrompt.prompt,
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
