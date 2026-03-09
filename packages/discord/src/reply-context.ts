export type DiscordReplyContext = {
  mentionUserId: string;
};

type CreateDiscordReplyContextInput = {
  relayBotId: string;
  authorId: string;
  authorBot: boolean;
};

type DiscordReplyPayloadExtras = {
  embeds?: any[];
  files?: string[];
};

type DiscordReplyPayload = string | {
  content: string;
  allowedMentions?: {
    users: string[];
  };
  embeds?: any[];
  files?: string[];
};

function prependTargetMention(content: string, mentionUserId: string): string {
  const mention = `<@${mentionUserId}>`;
  const alternateMention = `<@!${mentionUserId}>`;
  if (content.startsWith(mention) || content.startsWith(alternateMention)) {
    return content;
  }

  return content ? `${mention} ${content}` : mention;
}

export function createDiscordReplyContext(
  input: CreateDiscordReplyContextInput,
): DiscordReplyContext | undefined {
  if (!input.authorBot || input.authorId === input.relayBotId) {
    return undefined;
  }

  return {
    mentionUserId: input.authorId,
  };
}

export function buildDiscordReplyPayload(
  content: string,
  replyContext?: DiscordReplyContext,
  extras?: DiscordReplyPayloadExtras,
): DiscordReplyPayload {
  if (!replyContext && !extras?.embeds?.length && !extras?.files?.length) {
    return content;
  }

  const payload: Exclude<DiscordReplyPayload, string> = {
    content: replyContext
      ? prependTargetMention(content, replyContext.mentionUserId)
      : content,
  };

  if (replyContext) {
    payload.allowedMentions = {
      users: [replyContext.mentionUserId],
    };
  }

  if (extras?.embeds?.length) {
    payload.embeds = extras.embeds;
  }

  if (extras?.files?.length) {
    payload.files = extras.files;
  }

  return payload;
}
