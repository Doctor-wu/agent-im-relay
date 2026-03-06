import { describe, expect, it } from 'vitest';
import { claudeControlCommandHandlers, claudeControlCommands } from '../commands/claude-control.js';

describe('claudeControlCommands', () => {
  it('does not register a cwd command', () => {
    const commandNames = claudeControlCommands.map((command) => command.toJSON().name);

    expect(commandNames).not.toContain('cwd');
    expect(claudeControlCommandHandlers.has('cwd')).toBe(false);
  });
});
