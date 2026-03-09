type ResolveInboundDiscordMessageInput = {
  relayBotId: string;
  authorId: string;
  authorBot: boolean;
  content: string;
  inGuild: boolean;
  inActiveThread: boolean;
};

type RejectedInboundDiscordMessage = {
  accepted: false;
};

type AcceptedInboundDiscordMessage = {
  accepted: true;
  prompt: string;
  explicitMention: boolean;
};

export type ResolvedInboundDiscordMessage =
  | RejectedInboundDiscordMessage
  | AcceptedInboundDiscordMessage;

function createMentionRegex(relayBotId: string, flags = ''): RegExp {
  return new RegExp(`<@!?${relayBotId}>`, flags);
}

export function extractMentionPrompt(content: string, relayBotId: string): string {
  return content.replace(createMentionRegex(relayBotId, 'g'), '').replace(/\s+/g, ' ').trim();
}

export function resolveInboundDiscordMessage(
  input: ResolveInboundDiscordMessageInput,
): ResolvedInboundDiscordMessage {
  if (!input.inGuild) {
    return { accepted: false };
  }

  if (input.authorBot && input.authorId === input.relayBotId) {
    return { accepted: false };
  }

  const explicitMention = createMentionRegex(input.relayBotId).test(input.content);
  if (input.authorBot && !explicitMention) {
    return { accepted: false };
  }

  if (!explicitMention && !input.inActiveThread) {
    return { accepted: false };
  }

  return {
    accepted: true,
    prompt: explicitMention
      ? extractMentionPrompt(input.content, input.relayBotId)
      : input.content.trim(),
    explicitMention,
  };
}
