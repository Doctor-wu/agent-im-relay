export function parseSlackCodeCommand(text: string): string | null {
  const prompt = text.trim();
  return prompt || null;
}
