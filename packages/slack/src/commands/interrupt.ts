export function resolveSlackInterruptTarget(conversationId: string | null): string | null {
  return conversationId?.trim() || null;
}
