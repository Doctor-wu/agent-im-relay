export interface SlackSkillCommand {
  skillName: string;
  prompt: string;
}

export function parseSlackSkillCommand(text: string): SlackSkillCommand | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const [skillName, ...promptParts] = trimmed.split(/\s+/u);
  const prompt = promptParts.join(' ').trim();
  if (!skillName || !prompt) {
    return null;
  }

  return {
    skillName,
    prompt,
  };
}
