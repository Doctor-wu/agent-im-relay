export const relayPlatforms = ['discord', 'feishu', 'slack', 'wechat'] as const;

export type RelayPlatform = (typeof relayPlatforms)[number];

export function isRelayPlatform(value: unknown): value is RelayPlatform {
  return typeof value === 'string' && relayPlatforms.includes(value as RelayPlatform);
}

export function inferRelayPlatformFromConversationId(conversationId: string): RelayPlatform {
  if (/^\d+$/.test(conversationId)) {
    return 'discord';
  }

  if (/^\d+\.\d+$/.test(conversationId)) {
    return 'slack';
  }

  if (conversationId.startsWith('wechat:')) {
    return 'wechat';
  }

  return 'feishu';
}
