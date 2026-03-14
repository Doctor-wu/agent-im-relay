import { describe, expect, it } from 'vitest';

describe('Slack command helpers', () => {
  it('parses /code prompts by trimming whitespace', async () => {
    const { parseSlackCodeCommand } = await import('../commands/code.js');

    expect(parseSlackCodeCommand('  ship it  ')).toBe('ship it');
    expect(parseSlackCodeCommand('   ')).toBeNull();
  });

  it('parses /ask prompts by trimming whitespace', async () => {
    const { parseSlackAskCommand } = await import('../commands/ask.js');

    expect(parseSlackAskCommand('  what changed?  ')).toBe('what changed?');
    expect(parseSlackAskCommand('')).toBeNull();
  });

  it('parses /skill into skill name and prompt', async () => {
    const { parseSlackSkillCommand } = await import('../commands/skill.js');

    expect(parseSlackSkillCommand('brainstorming outline the rollout')).toEqual({
      skillName: 'brainstorming',
      prompt: 'outline the rollout',
    });
    expect(parseSlackSkillCommand('brainstorming')).toBeNull();
  });

  it('resolves thread-only control command targets', async () => {
    const { resolveSlackInterruptTarget } = await import('../commands/interrupt.js');
    const { resolveSlackDoneTarget } = await import('../commands/done.js');

    expect(resolveSlackInterruptTarget('1741766400.123456')).toBe('1741766400.123456');
    expect(resolveSlackInterruptTarget(null)).toBeNull();
    expect(resolveSlackDoneTarget('1741766400.123456')).toBe('1741766400.123456');
    expect(resolveSlackDoneTarget(null)).toBeNull();
  });
});
