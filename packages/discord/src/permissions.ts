export type DiscordPermissionDecision = 'approved' | 'denied' | 'timeout';

export type DiscordPermissionCard = {
  conversationId: string;
  requestId: string;
  tool?: string;
  reason?: string;
};

type DiscordButton = {
  type: number;
  style: number;
  custom_id: string;
  label: string;
};

export function buildDiscordPermissionMessage(
  card: DiscordPermissionCard,
  decision?: DiscordPermissionDecision,
): {
  content: string;
  components?: Array<{ type: number; components: DiscordButton[] }>;
} {
  const title = card.tool
    ? `Permission required: ${card.tool}`
    : 'Permission required';
  const detail = card.reason ? `\n${card.reason}` : '';
  const status = decision
    ? `\nStatus: ${decision === 'approved' ? 'approved' : decision === 'timeout' ? 'timed out and denied' : 'denied'}`
    : '';

  return {
    content: `**${title}**${detail}${status}`,
    ...(decision
      ? {}
      : {
          components: [{
            type: 1,
            components: [
              {
                type: 2,
                style: 3,
                custom_id: buildDiscordPermissionCustomId(card.conversationId, card.requestId, 'approved'),
                label: 'Approve',
              },
              {
                type: 2,
                style: 4,
                custom_id: buildDiscordPermissionCustomId(card.conversationId, card.requestId, 'denied'),
                label: 'Deny',
              },
            ],
          }],
        }),
  };
}

export function buildDiscordPermissionCustomId(
  conversationId: string,
  requestId: string,
  decision: 'approved' | 'denied',
): string {
  return `permission:${decision}:${conversationId}:${requestId}`;
}

export function parseDiscordPermissionCustomId(customId: string): {
  conversationId: string;
  requestId: string;
  decision: 'approved' | 'denied';
} | null {
  const segments = customId.split(':');
  const [prefix, decision, conversationId] = segments;
  const requestId = segments.slice(3).join(':');
  if (
    prefix !== 'permission'
    || (decision !== 'approved' && decision !== 'denied')
    || !conversationId
    || !requestId
  ) {
    return null;
  }

  return {
    conversationId,
    requestId,
    decision,
  };
}
