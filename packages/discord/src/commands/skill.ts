import {
  ActionRowBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AnyThreadChannel,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { listSkills } from '@agent-im-relay/core';

const MAX_SELECT_OPTIONS = 25;
const MAX_OPTION_DESCRIPTION = 100;
const MAX_MODAL_TITLE = 45;
const SKILL_PROMPT_INPUT_ID = 'prompt';

export const SKILL_SELECT_CUSTOM_ID = 'skill-select';
export const SKILL_MODAL_CUSTOM_ID_PREFIX = 'skill-modal:';

export type SkillConversationRunner = (thread: AnyThreadChannel, prompt: string) => Promise<boolean>;

export const skillCommand = new SlashCommandBuilder()
  .setName('skill')
  .setDescription('Run agent with an installed skill in this thread')
  .setDMPermission(false);

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
}

function requireThreadChannel(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
): AnyThreadChannel | null {
  const channel = interaction.channel;
  return channel?.isThread() ? channel : null;
}

export function buildSkillPrompt(skillName: string, prompt: string): string {
  return `/${skillName} ${prompt.trim()}`.trim();
}

export function getSkillNameFromModalCustomId(customId: string): string | null {
  if (!customId.startsWith(SKILL_MODAL_CUSTOM_ID_PREFIX)) {
    return null;
  }

  const skillName = customId.slice(SKILL_MODAL_CUSTOM_ID_PREFIX.length).trim();
  return skillName || null;
}

export async function handleSkillCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = requireThreadChannel(interaction);
  if (!channel) {
    await interaction.reply({ content: 'This command only works inside a thread.', ephemeral: true });
    return;
  }

  const skills = await listSkills();
  if (skills.length === 0) {
    await interaction.reply({ content: 'No agent skills were found in `~/.claude/skills`.', ephemeral: true });
    return;
  }

  const visibleSkills = skills.slice(0, MAX_SELECT_OPTIONS);
  const options = visibleSkills.map((skill) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(truncate(skill.name, 100))
      .setValue(skill.name)
      .setDescription(truncate(skill.description, MAX_OPTION_DESCRIPTION)),
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(SKILL_SELECT_CUSTOM_ID)
    .setPlaceholder('Select a skill')
    .addOptions(options);

  const content = skills.length > MAX_SELECT_OPTIONS
    ? `Choose a skill for this thread. Showing the first ${MAX_SELECT_OPTIONS} of ${skills.length} skills.`
    : 'Choose a skill for this thread.';

  await interaction.reply({
    content,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    ephemeral: true,
  });
}

export async function handleSkillSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  if (interaction.customId !== SKILL_SELECT_CUSTOM_ID) {
    return;
  }

  const skillName = interaction.values[0]?.trim();
  if (!skillName) {
    await interaction.reply({ content: 'Please select a skill first.', ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${SKILL_MODAL_CUSTOM_ID_PREFIX}${skillName}`)
    .setTitle(truncate(`Use skill: ${skillName}`, MAX_MODAL_TITLE))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(SKILL_PROMPT_INPUT_ID)
          .setLabel('prompt')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder('What should Agent do with this skill?'),
      ),
    );

  await interaction.showModal(modal);
}

export async function handleSkillModalSubmit(
  interaction: ModalSubmitInteraction,
  runConversation: SkillConversationRunner,
): Promise<void> {
  const skillName = getSkillNameFromModalCustomId(interaction.customId);
  if (!skillName) {
    return;
  }

  const channel = requireThreadChannel(interaction);
  if (!channel) {
    await interaction.reply({ content: 'This action only works inside a thread.', ephemeral: true });
    return;
  }

  const prompt = interaction.fields.getTextInputValue(SKILL_PROMPT_INPUT_ID).trim();
  if (!prompt) {
    await interaction.reply({ content: 'Please provide a prompt.', ephemeral: true });
    return;
  }

  const fullPrompt = buildSkillPrompt(skillName, prompt);
  await interaction.reply({ content: `Starting \`/${skillName}\` in this thread…`, ephemeral: true });

  const started = await runConversation(channel, fullPrompt);
  if (!started) {
    await interaction.editReply('Agent is already busy in this thread.');
  }
}
