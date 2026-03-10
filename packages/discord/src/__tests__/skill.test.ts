import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listSkills, runMentionConversation, readFile } = vi.hoisted(() => ({
  listSkills: vi.fn(),
  runMentionConversation: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('@agent-im-relay/core', async () => {
  const actual = await vi.importActual<typeof import('@agent-im-relay/core')>('@agent-im-relay/core');
  return {
    ...actual,
    listSkills,
  };
});

vi.mock('../conversation.js', () => ({
  runMentionConversation,
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readFile,
  };
});

import * as skillModule from '../commands/skill.js';

function createSkillMarkdown(options: { tags?: string; aliases?: string } = {}): string {
  const lines = ['---'];

  if (options.tags) {
    lines.push(`tags: ${options.tags}`);
  }

  if (options.aliases) {
    lines.push(`aliases: ${options.aliases}`);
  }

  lines.push('---');
  return lines.join('\n');
}

describe('skill command', () => {
  beforeEach(() => {
    listSkills.mockReset();
    runMentionConversation.mockReset();
    readFile.mockReset();
    listSkills.mockResolvedValue([]);
    readFile.mockResolvedValue(createSkillMarkdown());
  });

  it('defines an autocomplete skill name option and a required prompt option', () => {
    const command = skillModule.skillCommand.toJSON();

    expect(command.options?.[0]).toMatchObject({
      name: 'name',
      description: 'Skill name',
      required: true,
      autocomplete: true,
    });
    expect(command.options?.[1]).toMatchObject({
      name: 'prompt',
      description: 'What should Agent do with this skill?',
      required: true,
    });
  });

  it('parses comma-separated tags and yaml-list aliases from skill frontmatter', () => {
    const frontmatter = [
      '---',
      'tags: lint, format, review',
      'aliases:',
      '  - cleanup',
      '  - tidy',
      '---',
    ].join('\n');

    const metadata = (skillModule as any).parseSkillSearchFrontmatter?.(frontmatter);

    expect(metadata).toEqual({
      tags: ['lint', 'format', 'review'],
      aliases: ['cleanup', 'tidy'],
    });
  });

  it('searches name, description, tags, and aliases with startsWith matches ahead of contains matches', async () => {
    listSkills.mockResolvedValue([
      { name: 'lint-fix', description: 'Fix lint issues', dir: '/skills/lint-fix' },
      { name: 'workflow', description: 'Lint and format workflows', dir: '/skills/workflow' },
      { name: 'cleanup', description: 'Code cleanup', dir: '/skills/cleanup' },
      { name: 'alpha-lint', description: 'Other tools', dir: '/skills/alpha-lint' },
    ]);

    readFile.mockImplementation(async (filePath: string) => {
      if (filePath.includes('cleanup')) {
        return createSkillMarkdown({ aliases: 'lint-helper' });
      }

      if (filePath.includes('alpha-lint')) {
        return createSkillMarkdown({ tags: 'lint' });
      }

      return createSkillMarkdown();
    });

    const interaction = {
      options: {
        getFocused: vi.fn().mockReturnValue('lint'),
      },
      respond: vi.fn().mockResolvedValue(undefined),
    } as any;

    await (skillModule as any).handleSkillAutocomplete?.(interaction);

    expect(interaction.respond).toHaveBeenCalledWith([
      { name: 'lint-fix', value: 'lint-fix' },
      { name: 'cleanup', value: 'cleanup' },
      { name: 'alpha-lint', value: 'alpha-lint' },
      { name: 'workflow', value: 'workflow' },
    ]);
  });

  it('limits autocomplete responses to 25 choices', async () => {
    listSkills.mockResolvedValue(
      Array.from({ length: 30 }, (_, index) => ({
        name: `skill-${String(index).padStart(2, '0')}`,
        description: `Description ${index}`,
        dir: `/skills/${index}`,
      })),
    );

    const interaction = {
      options: {
        getFocused: vi.fn().mockReturnValue(''),
      },
      respond: vi.fn().mockResolvedValue(undefined),
    } as any;

    await (skillModule as any).handleSkillAutocomplete?.(interaction);

    expect(interaction.respond).toHaveBeenCalledTimes(1);
    expect(interaction.respond.mock.calls[0]?.[0]).toHaveLength(25);
    expect(interaction.respond.mock.calls[0]?.[0]?.[0]).toEqual({
      name: 'skill-00',
      value: 'skill-00',
    });
  });

  it('returns no autocomplete choices when nothing matches', async () => {
    listSkills.mockResolvedValue([
      { name: 'lint-fix', description: 'Fix lint issues', dir: '/skills/lint-fix' },
    ]);

    const interaction = {
      options: {
        getFocused: vi.fn().mockReturnValue('nope'),
      },
      respond: vi.fn().mockResolvedValue(undefined),
    } as any;

    await (skillModule as any).handleSkillAutocomplete?.(interaction);

    expect(interaction.respond).toHaveBeenCalledWith([]);
  });

  it('returns all choices when there are exactly 25 autocomplete matches', async () => {
    listSkills.mockResolvedValue(
      Array.from({ length: 25 }, (_, index) => ({
        name: `skill-${String(index).padStart(2, '0')}`,
        description: `Description ${index}`,
        dir: `/skills/${index}`,
      })),
    );

    const interaction = {
      options: {
        getFocused: vi.fn().mockReturnValue(''),
      },
      respond: vi.fn().mockResolvedValue(undefined),
    } as any;

    await (skillModule as any).handleSkillAutocomplete?.(interaction);

    expect(interaction.respond).toHaveBeenCalledTimes(1);
    expect(interaction.respond.mock.calls[0]?.[0]).toHaveLength(25);
    expect(interaction.respond.mock.calls[0]?.[0]?.[24]).toEqual({
      name: 'skill-24',
      value: 'skill-24',
    });
  });

  it('matches autocomplete queries that include special characters', async () => {
    listSkills.mockResolvedValue([
      { name: 'quality-check', description: 'Checks vue-tsc output', dir: '/skills/quality-check' },
    ]);

    readFile.mockResolvedValue(createSkillMarkdown({ aliases: 'vue-tsc' }));

    const interaction = {
      options: {
        getFocused: vi.fn().mockReturnValue('vue-tsc'),
      },
      respond: vi.fn().mockResolvedValue(undefined),
    } as any;

    await (skillModule as any).handleSkillAutocomplete?.(interaction);

    expect(interaction.respond).toHaveBeenCalledWith([
      { name: 'quality-check', value: 'quality-check' },
    ]);
  });

  it('runs the selected skill directly in the current thread', async () => {
    listSkills.mockResolvedValue([
      { name: 'lint-fix', description: 'Fix lint issues', dir: '/skills/lint-fix' },
    ]);
    runMentionConversation.mockResolvedValue(true);

    const thread = {
      id: 'thread-1',
      isThread: () => true,
    };
    const interaction = {
      channel: thread,
      options: {
        getString: vi.fn((name: string) => name === 'name' ? 'lint-fix' : 'Refactor the tests'),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as any;

    await skillModule.handleSkillCommand(interaction);

    expect(runMentionConversation).toHaveBeenCalledWith(thread, '/lint-fix Refactor the tests');
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalledWith('Starting `/lint-fix` in this thread…');
  });

  it('rejects unknown skill names before starting a run', async () => {
    listSkills.mockResolvedValue([
      { name: 'lint-fix', description: 'Fix lint issues', dir: '/skills/lint-fix' },
    ]);

    const interaction = {
      channel: {
        id: 'thread-3',
        isThread: () => true,
      },
      options: {
        getString: vi.fn((name: string) => name === 'name' ? 'missing-skill' : 'Retry later'),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as any;

    await skillModule.handleSkillCommand(interaction);

    expect(runMentionConversation).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith('Unknown skill `missing-skill`. Please choose a skill from autocomplete.');
  });

  it('reports when the thread already has an active skill run', async () => {
    listSkills.mockResolvedValue([
      { name: 'lint-fix', description: 'Fix lint issues', dir: '/skills/lint-fix' },
    ]);
    runMentionConversation.mockResolvedValue(false);

    const interaction = {
      channel: {
        id: 'thread-2',
        isThread: () => true,
      },
      options: {
        getString: vi.fn((name: string) => name === 'name' ? 'lint-fix' : 'Retry later'),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as any;

    await skillModule.handleSkillCommand(interaction);

    expect(interaction.editReply).toHaveBeenNthCalledWith(1, 'Starting `/lint-fix` in this thread…');
    expect(interaction.editReply).toHaveBeenNthCalledWith(2, 'Agent is already busy in this thread.');
  });
});
