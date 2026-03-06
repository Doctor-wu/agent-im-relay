import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ensureConversationArtifactPaths,
  getConversationArtifactMetadata,
  persistConversationArtifactMetadata,
  type ArtifactKind,
  type ArtifactRecord,
} from '@agent-im-relay/core';
import { config } from './config.js';

export const attachmentOptionNames = ['file', 'file2', 'file3'] as const;

export type DiscordAttachmentLike = {
  id?: string;
  name?: string | null;
  url: string;
  contentType?: string | null;
  size?: number;
};

export type DownloadedAttachment = ArtifactRecord & {
  localPath: string;
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

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim();
  const normalized = trimmed
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim();

  return normalized || 'attachment';
}

function splitFilename(filename: string): { base: string; extension: string } {
  const extension = path.extname(filename);
  const base = path.basename(filename, extension) || 'attachment';
  return { base, extension };
}

function allocateRelativePath(filename: string, usedPaths: Set<string>): string {
  const safeFilename = sanitizeFilename(filename);
  const { base, extension } = splitFilename(safeFilename);

  let attempt = 0;
  while (true) {
    const candidateName = attempt === 0
      ? `${base}${extension}`
      : `${base}-${attempt + 1}${extension}`;
    const relativePath = path.posix.join('incoming', candidateName);
    if (!usedPaths.has(relativePath)) {
      usedPaths.add(relativePath);
      return relativePath;
    }
    attempt++;
  }
}

function inferArtifactKind(attachment: DiscordAttachmentLike): ArtifactKind {
  const mimeType = attachment.contentType?.toLowerCase() ?? '';
  const extension = path.extname(attachment.name ?? '').toLowerCase();

  if (mimeType.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(extension)) {
    return 'image';
  }
  if (mimeType === 'text/markdown' || extension === '.md') {
    return 'markdown';
  }
  if (mimeType === 'application/pdf' || extension === '.pdf') {
    return 'pdf';
  }
  if (mimeType.startsWith('audio/')) {
    return 'audio';
  }
  if (mimeType.startsWith('video/')) {
    return 'video';
  }
  return 'generic';
}

function isTextPreviewCandidate(attachment: DiscordAttachmentLike, kind: ArtifactKind): boolean {
  const mimeType = attachment.contentType?.toLowerCase() ?? '';
  const extension = path.extname(attachment.name ?? '').toLowerCase();
  return kind === 'markdown'
    || mimeType.startsWith('text/')
    || ['.txt', '.json', '.md', '.js', '.ts', '.tsx', '.jsx', '.yml', '.yaml'].includes(extension);
}

function buildPreview(
  attachment: DiscordAttachmentLike,
  kind: ArtifactKind,
  buffer: Buffer,
): string[] | undefined {
  if (!isTextPreviewCandidate(attachment, kind)) {
    return undefined;
  }

  const lines = buffer
    .toString('utf-8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.length > 0)
    .slice(0, 4)
    .map(line => line.slice(0, 160));

  return lines.length > 0 ? lines : undefined;
}

function formatByteSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

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

export async function downloadAttachments({
  conversationId,
  attachments,
  sourceMessageId,
  fetchImpl = globalThis.fetch,
}: DownloadAttachmentsOptions): Promise<DownloadedAttachment[]> {
  if (attachments.length === 0) {
    return [];
  }
  if (!fetchImpl) {
    throw new Error('Fetch is not available for attachment downloads.');
  }

  const paths = await ensureConversationArtifactPaths(conversationId);
  const existingMetadata = await getConversationArtifactMetadata(conversationId);
  const usedPaths = new Set(existingMetadata.incoming.map(record => record.relativePath));
  const downloaded: DownloadedAttachment[] = [];
  const createdAt = new Date().toISOString();

  for (const attachment of attachments) {
    if (attachment.size && attachment.size > config.maxAttachmentSizeBytes) {
      throw new Error(
        `Attachment exceeds max size of ${config.maxAttachmentSizeBytes} bytes: ${attachment.name ?? attachment.url}`,
      );
    }

    const response = await fetchImpl(attachment.url);
    if (!response.ok) {
      throw new Error(`Failed to download attachment: ${attachment.name ?? attachment.url}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > config.maxAttachmentSizeBytes) {
      throw new Error(
        `Attachment exceeds max size of ${config.maxAttachmentSizeBytes} bytes: ${attachment.name ?? attachment.url}`,
      );
    }

    const relativePath = allocateRelativePath(attachment.name ?? 'attachment', usedPaths);
    const localPath = path.join(paths.rootDir, relativePath);
    await writeFile(localPath, buffer);

    const kind = inferArtifactKind(attachment);
    downloaded.push({
      id: attachment.id ?? randomUUID(),
      filename: attachment.name ?? path.basename(relativePath),
      relativePath,
      mimeType: attachment.contentType ?? undefined,
      size: buffer.byteLength,
      kind,
      createdAt,
      sourceMessageId,
      preview: buildPreview(attachment, kind, buffer),
      localPath,
    });
  }

  await persistConversationArtifactMetadata(conversationId, {
    incoming: [
      ...existingMetadata.incoming,
      ...downloaded.map(({ localPath: _localPath, ...record }) => record),
    ],
    outgoing: existingMetadata.outgoing,
    lastUpdatedAt: createdAt,
  });

  return downloaded;
}

export function buildAttachmentPromptContext(attachments: DownloadedAttachment[]): string {
  if (attachments.length === 0) {
    return '';
  }

  const lines = ['Attached files are available locally for this run:'];

  for (const attachment of attachments) {
    const detail = [
      attachment.filename,
      `${attachment.kind}, ${formatByteSize(attachment.size)}`,
      attachment.mimeType ?? 'unknown mime',
    ].join(' | ');
    const previewLines = attachment.preview?.map(line => `  preview: ${line}`) ?? [];

    lines.push(
      `- ${detail}`,
      `  path: ${attachment.localPath}`,
      ...previewLines,
    );
  }

  return lines.join('\n');
}

export async function prepareAttachmentPrompt({
  conversationId,
  prompt,
  attachments,
  sourceMessageId,
  fetchImpl,
}: PrepareAttachmentPromptOptions): Promise<{ prompt: string; attachments: DownloadedAttachment[] }> {
  const downloaded = await downloadAttachments({
    conversationId,
    attachments,
    sourceMessageId,
    fetchImpl,
  });

  if (downloaded.length === 0) {
    return { prompt, attachments: downloaded };
  }

  return {
    prompt: `${buildAttachmentPromptContext(downloaded)}\n\nUser request:\n${prompt}`,
    attachments: downloaded,
  };
}
