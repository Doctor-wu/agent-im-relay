export const relayPlatforms = ['discord', 'feishu', 'telegram'] as const;

export type RelayPlatform = (typeof relayPlatforms)[number];

export function isRelayPlatform(value: unknown): value is RelayPlatform {
  return typeof value === 'string' && relayPlatforms.includes(value as RelayPlatform);
}

export function inferRelayPlatformFromConversationId(conversationId: string): RelayPlatform {
  if (conversationId.startsWith('tg-')) return 'telegram';
  return /^\d+$/.test(conversationId) ? 'discord' : 'feishu';
}
