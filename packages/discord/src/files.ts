import {
  buildAttachmentPromptContext,
  downloadIncomingAttachments,
  prepareAttachmentPrompt,
  type DownloadedAttachment,
} from '@agent-im-relay/core';

export const attachmentOptionNames = ['file', 'file2', 'file3'] as const;

export type DiscordAttachmentLike = {
  id?: string;
  name?: string | null;
  url: string;
  contentType?: string | null;
  size?: number;
};

type DownloadAttachmentsOptions = {
  conversationId: string;
  attachments: DiscordAttachmentLike[];
  sourceMessageId?: string;
  fetchImpl?: typeof fetch;
};

type PrepareAttachmentPromptOptions = DownloadAttachmentsOptions & {
  prompt: string;
};

function normalizeAttachment(attachment: DiscordAttachmentLike): DiscordAttachmentLike | null {
  if (!attachment?.url) {
    return null;
  }

  return {
    id: attachment.id,
    name: attachment.name ?? null,
    url: attachment.url,
    contentType: attachment.contentType ?? null,
    size: attachment.size,
  };
}

export function collectInteractionAttachments(
  options: { getAttachment(name: string): DiscordAttachmentLike | null },
): DiscordAttachmentLike[] {
  return attachmentOptionNames
    .map(name => normalizeAttachment(options.getAttachment(name)))
    .filter((attachment): attachment is DiscordAttachmentLike => attachment !== null);
}

export function collectMessageAttachments(
  message?: { attachments?: { values(): IterableIterator<DiscordAttachmentLike> } },
): DiscordAttachmentLike[] {
  if (!message?.attachments) {
    return [];
  }

  return [...message.attachments.values()]
    .map(normalizeAttachment)
    .filter((attachment): attachment is DiscordAttachmentLike => attachment !== null);
}

export async function downloadAttachments(options: DownloadAttachmentsOptions): Promise<DownloadedAttachment[]> {
  return downloadIncomingAttachments(options);
}

export { buildAttachmentPromptContext };

export async function prepareAttachmentPromptWithDiscordAttachments(
  options: PrepareAttachmentPromptOptions,
): Promise<{ prompt: string; attachments: DownloadedAttachment[] }> {
  return prepareAttachmentPrompt(options);
}

export { prepareAttachmentPromptWithDiscordAttachments as prepareAttachmentPrompt };
