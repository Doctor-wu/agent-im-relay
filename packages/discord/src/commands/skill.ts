import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  SlashCommandBuilder,
  type AnyThreadChannel,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { listSkills, type SkillInfo } from '@agent-im-relay/core';
import { runMentionConversation } from '../conversation.js';

const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_AUTOCOMPLETE_NAME = 100;

type SkillSearchMetadata = {
  aliases: string[];
  tags: string[];
};

type SearchableSkill = SkillInfo & SkillSearchMetadata;

const emptySkillSearchMetadata: SkillSearchMetadata = {
  aliases: [],
  tags: [],
};

const skillSearchMetadataCache = new Map<string, Promise<SkillSearchMetadata>>();

export const skillCommand = new SlashCommandBuilder()
  .setName('skill')
  .setDescription('Run agent with an installed skill in this thread')
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('name')
      .setDescription('Skill name')
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((option) =>
    option
      .setName('prompt')
      .setDescription('What should Agent do with this skill?')
      .setRequired(true),
  );

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
}

function cleanFrontmatterValue(value: string): string {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function parseFrontmatterListValue(value: string): string[] {
  const trimmed = cleanFrontmatterValue(value);
  const normalized = trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed;

  return normalized
    .split(',')
    .map(entry => cleanFrontmatterValue(entry))
    .filter(Boolean);
}

export function parseSkillSearchFrontmatter(markdown: string): SkillSearchMetadata {
  const sections = markdown.split('---');
  if (sections.length < 3) {
    return emptySkillSearchMetadata;
  }

  const frontmatter = sections[1] ?? '';
  const metadata: SkillSearchMetadata = {
    aliases: [],
    tags: [],
  };
  let currentKey: keyof SkillSearchMetadata | null = null;

  for (const line of frontmatter.split(/\r?\n/u)) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const keyMatch = trimmed.match(/^(aliases|tags):(?:\s*(.+))?$/u);
    if (keyMatch) {
      const key = keyMatch[1] as keyof SkillSearchMetadata;
      const inlineValue = keyMatch[2]?.trim();
      metadata[key] = inlineValue ? parseFrontmatterListValue(inlineValue) : [];
      currentKey = inlineValue ? null : key;
      continue;
    }

    if (currentKey && trimmed.startsWith('- ')) {
      const entry = cleanFrontmatterValue(trimmed.slice(2));
      if (entry) {
        metadata[currentKey].push(entry);
      }
      continue;
    }

    currentKey = null;
  }

  return {
    aliases: [...new Set(metadata.aliases)],
    tags: [...new Set(metadata.tags)],
  };
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function getSearchRank(skill: SearchableSkill, query: string): number | null {
  if (!query) {
    return 0;
  }

  const rankedFields = [
    { values: [skill.name], startsWithRank: 0, containsRank: 4 },
    { values: skill.aliases, startsWithRank: 1, containsRank: 5 },
    { values: skill.tags, startsWithRank: 2, containsRank: 6 },
    { values: [skill.description], startsWithRank: 3, containsRank: 7 },
  ] as const;

  let bestRank: number | null = null;

  for (const field of rankedFields) {
    const terms = field.values
      .map(normalizeSearchValue)
      .filter(Boolean);

    if (terms.some(term => term.startsWith(query))) {
      bestRank = bestRank === null ? field.startsWithRank : Math.min(bestRank, field.startsWithRank);
      continue;
    }

    if (terms.some(term => term.includes(query))) {
      bestRank = bestRank === null ? field.containsRank : Math.min(bestRank, field.containsRank);
    }
  }

  return bestRank;
}

function compareSkills(left: SearchableSkill, right: SearchableSkill): number {
  return left.name.localeCompare(right.name);
}

function createAutocompleteChoice(skill: SearchableSkill): { name: string; value: string } {
  return {
    name: truncate(skill.name, MAX_AUTOCOMPLETE_NAME),
    value: skill.name,
  };
}

async function loadSkillSearchMetadata(skill: SkillInfo): Promise<SkillSearchMetadata> {
  const cached = skillSearchMetadataCache.get(skill.dir);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const skillFile = path.join(skill.dir, 'SKILL.md');

    try {
      const markdown = await readFile(skillFile, 'utf8');
      return parseSkillSearchFrontmatter(markdown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return emptySkillSearchMetadata;
      }

      throw error;
    }
  })();

  skillSearchMetadataCache.set(skill.dir, pending);
  return pending;
}

async function loadSearchableSkills(): Promise<SearchableSkill[]> {
  const skills = await listSkills();

  return Promise.all(
    skills.map(async (skill) => ({
      ...skill,
      ...(await loadSkillSearchMetadata(skill)),
    })),
  );
}

function requireThreadChannel(interaction: ChatInputCommandInteraction): AnyThreadChannel | null {
  const channel = interaction.channel;
  return channel?.isThread() ? channel : null;
}

function findSkillByName(skills: SkillInfo[], input: string): SkillInfo | null {
  const normalizedInput = normalizeSearchValue(input);
  return skills.find(skill => normalizeSearchValue(skill.name) === normalizedInput) ?? null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function buildSkillPrompt(skillName: string, prompt: string): string {
  return `/${skillName} ${prompt.trim()}`.trim();
}

export async function handleSkillAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const query = normalizeSearchValue(interaction.options.getFocused());

  try {
    const skills = await loadSearchableSkills();
    const choices = skills
      .map(skill => ({
        skill,
        rank: getSearchRank(skill, query),
      }))
      .filter((entry): entry is { skill: SearchableSkill; rank: number } => entry.rank !== null)
      .sort((left, right) => left.rank - right.rank || compareSkills(left.skill, right.skill))
      .slice(0, MAX_AUTOCOMPLETE_CHOICES)
      .map(entry => createAutocompleteChoice(entry.skill));

    await interaction.respond(choices);
  } catch {
    await interaction.respond([]).catch(() => {});
  }
}

export async function handleSkillCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = requireThreadChannel(interaction);
  if (!channel) {
    await interaction.reply({ content: 'This command only works inside a thread.', ephemeral: true });
    return;
  }

  const skillName = interaction.options.getString('name', true).trim();
  const prompt = interaction.options.getString('prompt', true).trim();

  if (!skillName) {
    await interaction.reply({ content: 'Please provide a skill name.', ephemeral: true });
    return;
  }

  if (!prompt) {
    await interaction.reply({ content: 'Please provide a prompt.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const skills = await listSkills();
    const matchingSkill = findSkillByName(skills, skillName);
    if (!matchingSkill) {
      await interaction.editReply(`Unknown skill \`${skillName}\`. Please choose a skill from autocomplete.`);
      return;
    }

    const fullPrompt = buildSkillPrompt(matchingSkill.name, prompt);
    await interaction.editReply(`Starting \`/${matchingSkill.name}\` in this thread…`);

    const started = await runMentionConversation(channel, fullPrompt);
    if (!started) {
      await interaction.editReply('Agent is already busy in this thread.');
    }
  } catch (error) {
    await interaction.editReply(`Failed to run /skill: ${toErrorMessage(error)}`);
  }
}
