export function resolveSlackDoneTarget(conversationId: string | null): string | null {
  return conversationId?.trim() || null;
}
