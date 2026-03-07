export function parseAskCommand(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.toLowerCase().startsWith('/ask')) {
    return null;
  }

  const prompt = trimmed.slice(4).trim();
  return prompt || null;
}
