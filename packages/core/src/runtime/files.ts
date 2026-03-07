import { randomUUID } from 'node:crypto';
import { copyFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import {
  cloneConversationArtifactMetadata,
  ensureConversationArtifactPaths,
} from '../artifacts/store.js';
import { parseArtifactManifest, resolveArtifactCandidatePaths } from '../artifacts/protocol.js';
import type { ArtifactKind, ArtifactManifestFile, ArtifactRecord } from '../artifacts/types.js';
import { getConversationArtifactMetadata, persistConversationArtifactMetadata } from '../state.js';

export type RemoteAttachmentLike = {
  id?: string;
  name?: string | null;
  url: string;
  contentType?: string | null;
  size?: number;
};

export type DownloadedAttachment = ArtifactRecord & {
  localPath: string;
};

type DownloadIncomingAttachmentsOptions = {
  conversationId: string;
  attachments: RemoteAttachmentLike[];
  sourceMessageId?: string;
  fetchImpl?: typeof fetch;
};

type PrepareAttachmentPromptOptions = DownloadIncomingAttachmentsOptions & {
  prompt: string;
};

type StageOutgoingArtifactsOptions = {
  conversationId: string;
  cwd: string;
  resultText: string;
  sourceMessageId?: string;
};

export type StagedArtifactsResult = {
  files: string[];
  records: ArtifactRecord[];
  warnings: string[];
};

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim();
  const normalized = trimmed
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim();

  return normalized || 'artifact';
}

function splitFilename(filename: string): { base: string; extension: string } {
  const extension = path.extname(filename);
  const base = path.basename(filename, extension) || 'artifact';
  return { base, extension };
}

function allocateRelativePath(prefix: 'incoming' | 'outgoing', filename: string, usedPaths: Set<string>): string {
  const safeFilename = sanitizeFilename(filename);
  const { base, extension } = splitFilename(safeFilename);

  let attempt = 0;
  while (true) {
    const candidateName = attempt === 0
      ? `${base}${extension}`
      : `${base}-${attempt + 1}${extension}`;
    const relativePath = path.posix.join(prefix, candidateName);
    if (!usedPaths.has(relativePath)) {
      usedPaths.add(relativePath);
      return relativePath;
    }
    attempt++;
  }
}

function inferArtifactKind(filename: string, mimeType?: string | null): ArtifactKind {
  const lowerMime = mimeType?.toLowerCase() ?? '';
  const extension = path.extname(filename).toLowerCase();

  if (lowerMime.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(extension)) {
    return 'image';
  }
  if (lowerMime === 'text/markdown' || extension === '.md') {
    return 'markdown';
  }
  if (lowerMime === 'application/pdf' || extension === '.pdf') {
    return 'pdf';
  }
  if (lowerMime.startsWith('audio/')) {
    return 'audio';
  }
  if (lowerMime.startsWith('video/')) {
    return 'video';
  }
  return 'generic';
}

function isTextPreviewCandidate(filename: string, mimeType: string | null | undefined, kind: ArtifactKind): boolean {
  const extension = path.extname(filename).toLowerCase();
  const lowerMime = mimeType?.toLowerCase() ?? '';

  return kind === 'markdown'
    || lowerMime.startsWith('text/')
    || ['.txt', '.json', '.md', '.js', '.ts', '.tsx', '.jsx', '.yml', '.yaml'].includes(extension);
}

function buildPreview(filename: string, mimeType: string | null | undefined, kind: ArtifactKind, buffer: Buffer): string[] | undefined {
  if (!isTextPreviewCandidate(filename, mimeType, kind)) {
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

async function statIfExists(filePath: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function resolveManifestSourcePath(
  manifestFile: ArtifactManifestFile,
  cwd: string,
  artifactRoot: string,
): Promise<{ filePath: string } | { warning: string }> {
  const candidates = resolveArtifactCandidatePaths([cwd, artifactRoot], manifestFile.path);
  if (candidates.length === 0) {
    return { warning: `Skipped artifact \`${manifestFile.path}\`: path must stay within the allowed root.` };
  }

  for (const candidate of candidates) {
    const stats = await statIfExists(candidate);
    if (!stats) {
      continue;
    }
    if (!stats.isFile()) {
      return { warning: `Skipped artifact \`${manifestFile.path}\`: path must reference a file.` };
    }
    return { filePath: candidate };
  }

  return { warning: `Skipped artifact \`${manifestFile.path}\`: file was not found.` };
}

export async function downloadIncomingAttachments({
  conversationId,
  attachments,
  sourceMessageId,
  fetchImpl = globalThis.fetch,
}: DownloadIncomingAttachmentsOptions): Promise<DownloadedAttachment[]> {
  if (attachments.length === 0) {
    return [];
  }
  if (!fetchImpl) {
    throw new Error('Fetch is not available for attachment downloads.');
  }

  const paths = await ensureConversationArtifactPaths(conversationId);
  const existingMetadata = cloneConversationArtifactMetadata(await getConversationArtifactMetadata(conversationId));
  const usedPaths = new Set(existingMetadata.incoming.map(record => record.relativePath));
  const downloaded: DownloadedAttachment[] = [];
  const createdAt = new Date().toISOString();

  for (const attachment of attachments) {
    if (attachment.size && attachment.size > config.artifactMaxSizeBytes) {
      throw new Error(
        `Attachment exceeds max size of ${config.artifactMaxSizeBytes} bytes: ${attachment.name ?? attachment.url}`,
      );
    }

    const response = await fetchImpl(attachment.url);
    if (!response.ok) {
      throw new Error(`Failed to download attachment: ${attachment.name ?? attachment.url}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > config.artifactMaxSizeBytes) {
      throw new Error(
        `Attachment exceeds max size of ${config.artifactMaxSizeBytes} bytes: ${attachment.name ?? attachment.url}`,
      );
    }

    const filename = attachment.name ?? 'attachment';
    const relativePath = allocateRelativePath('incoming', filename, usedPaths);
    const localPath = path.join(paths.rootDir, relativePath);
    await writeFile(localPath, buffer);

    const kind = inferArtifactKind(filename, attachment.contentType);
    downloaded.push({
      id: attachment.id ?? randomUUID(),
      filename,
      relativePath,
      mimeType: attachment.contentType ?? undefined,
      size: buffer.byteLength,
      kind,
      createdAt,
      sourceMessageId,
      preview: buildPreview(filename, attachment.contentType, kind, buffer),
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
    lines.push(
      `- ${attachment.filename} | ${attachment.kind}, ${formatByteSize(attachment.size)} | ${attachment.mimeType ?? 'unknown mime'}`,
      `  path: ${attachment.localPath}`,
      ...(attachment.preview?.map(line => `  preview: ${line}`) ?? []),
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
  const downloaded = await downloadIncomingAttachments({
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

export async function stageOutgoingArtifacts({
  conversationId,
  cwd,
  resultText,
  sourceMessageId,
}: StageOutgoingArtifactsOptions): Promise<StagedArtifactsResult> {
  const manifest = parseArtifactManifest(resultText);
  if (!manifest) {
    return { files: [], records: [], warnings: [] };
  }

  const paths = await ensureConversationArtifactPaths(conversationId);
  const existingMetadata = cloneConversationArtifactMetadata(await getConversationArtifactMetadata(conversationId));
  const usedPaths = new Set(existingMetadata.outgoing.map(record => record.relativePath));
  const createdAt = new Date().toISOString();
  const warnings: string[] = [];
  const files: string[] = [];
  const records: ArtifactRecord[] = [];

  for (const manifestFile of manifest.files) {
    const resolved = await resolveManifestSourcePath(manifestFile, cwd, paths.rootDir);
    if ('warning' in resolved) {
      warnings.push(`⚠️ ${resolved.warning}`);
      continue;
    }

    const filename = path.basename(resolved.filePath);
    const relativePath = allocateRelativePath('outgoing', filename, usedPaths);
    const storedPath = path.join(paths.rootDir, relativePath);
    const sourceStats = await stat(resolved.filePath);
    if (sourceStats.size > config.artifactMaxSizeBytes) {
      warnings.push(
        `⚠️ Skipped artifact \`${manifestFile.path}\`: file exceeds max size of ${config.artifactMaxSizeBytes} bytes.`,
      );
      continue;
    }

    await copyFile(resolved.filePath, storedPath);
    const storedStats = await stat(storedPath);
    const record: ArtifactRecord = {
      id: randomUUID(),
      filename,
      relativePath,
      mimeType: manifestFile.mimeType,
      size: storedStats.size,
      kind: inferArtifactKind(filename, manifestFile.mimeType),
      createdAt,
      sourceMessageId,
      title: manifestFile.title,
    };

    files.push(storedPath);
    records.push(record);
  }

  if (records.length > 0) {
    await persistConversationArtifactMetadata(conversationId, {
      incoming: existingMetadata.incoming,
      outgoing: [...existingMetadata.outgoing, ...records],
      lastUpdatedAt: createdAt,
    });
  }

  return { files, records, warnings };
}
