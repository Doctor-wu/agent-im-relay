import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { runMentionConversation } from '../conversation.js';
import { collectInteractionAttachments } from '../files.js';
import { ensureCodeThread } from '../thread.js';

export const codeCommand = new SlashCommandBuilder()
  .setName('code')
  .setDescription('Start a coding task in a dedicated thread')
  .setDMPermission(false)
  .addStringOption((option) =>
    option.setName('prompt').setDescription('What should Agent build or fix?').setRequired(true),
  )
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

export async function handleCodeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const prompt = interaction.options.getString('prompt', true).trim();
  const attachments = collectInteractionAttachments(interaction.options);
  if (!prompt) {
    await interaction.reply({ content: 'Please provide a prompt.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  let threadMention = 'the created thread';

  try {
    const thread = await ensureCodeThread(interaction, prompt);
    threadMention = thread.toString();

    await interaction.editReply(`Started coding in ${threadMention}`);
    await thread.send(`## /code\n${prompt}`);
    const started = await runMentionConversation(thread, prompt, undefined, { attachments });
    if (!started) {
      await interaction.editReply(`Agent is already busy in ${threadMention}`);
    }
  } catch (error) {
    const errorText = toErrorMessage(error);
    await interaction.editReply(`Failed to run /code in ${threadMention}: ${errorText}`);
  }
}
