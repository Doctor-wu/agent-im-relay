const SESSION_CHAT_TITLE_PREFIX = 'Session · ';
const SESSION_CHAT_PROMPT_LIMIT = 48;

export function normalizeFeishuSessionPromptPreview(prompt: string): string {
  const normalized = prompt
    .replace(/@_user_\d+\s*/g, '')
    .trim()
    .replace(/\s+/g, ' ');

  return normalized.slice(0, SESSION_CHAT_PROMPT_LIMIT) || 'New session';
}

export function buildFeishuSessionChatName(prompt: string): string {
  return `${SESSION_CHAT_TITLE_PREFIX}${normalizeFeishuSessionPromptPreview(prompt)}`;
}
