import { randomUUID } from 'node:crypto';
import { copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  ensureConversationArtifactPaths,
  getConversationArtifactMetadata,
  parseArtifactManifest,
  persistConversationArtifactMetadata,
  resolveArtifactPath,
  type ArtifactKind,
  type ArtifactManifestFile,
  type ArtifactRecord,
} from '@agent-im-relay/core';
import { config } from './config.js';

type ArtifactUploadChannel = {
  send(payload: string | { content: string; files: string[] }): Promise<unknown>;
};

type PublishConversationArtifactsOptions = {
  conversationId: string;
  cwd: string;
  resultText: string;
  channel: ArtifactUploadChannel;
  sourceMessageId?: string;
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

function allocateOutgoingRelativePath(filename: string, usedPaths: Set<string>): string {
  const safeFilename = sanitizeFilename(filename);
  const { base, extension } = splitFilename(safeFilename);

  let attempt = 0;
  while (true) {
    const candidateName = attempt === 0
      ? `${base}${extension}`
      : `${base}-${attempt + 1}${extension}`;
    const relativePath = path.posix.join('outgoing', candidateName);
    if (!usedPaths.has(relativePath)) {
      usedPaths.add(relativePath);
      return relativePath;
    }
    attempt++;
  }
}

function inferArtifactKind(filename: string, mimeType?: string): ArtifactKind {
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
  const candidateRoots = [cwd, artifactRoot];
  let hadAllowedRoot = false;

  for (const root of candidateRoots) {
    let resolvedPath: string;
    try {
      resolvedPath = resolveArtifactPath(root, manifestFile.path);
      hadAllowedRoot = true;
    } catch {
      continue;
    }

    const stats = await statIfExists(resolvedPath);
    if (!stats) {
      continue;
    }
    if (!stats.isFile()) {
      return { warning: `Skipped artifact \`${manifestFile.path}\`: path must reference a file.` };
    }

    return { filePath: resolvedPath };
  }

  if (!hadAllowedRoot) {
    return { warning: `Skipped artifact \`${manifestFile.path}\`: path must stay within the allowed root.` };
  }

  return { warning: `Skipped artifact \`${manifestFile.path}\`: file was not found.` };
}

export async function publishConversationArtifacts({
  conversationId,
  cwd,
  resultText,
  channel,
  sourceMessageId,
}: PublishConversationArtifactsOptions): Promise<void> {
  const manifest = parseArtifactManifest(resultText);
  if (!manifest) {
    return;
  }

  const paths = await ensureConversationArtifactPaths(conversationId);
  const existingMetadata = await getConversationArtifactMetadata(conversationId);
  const usedPaths = new Set(existingMetadata.outgoing.map(record => record.relativePath));
  const createdAt = new Date().toISOString();
  const warnings: string[] = [];
  const uploadedFiles: string[] = [];
  const outgoingRecords: ArtifactRecord[] = [];

  for (const manifestFile of manifest.files) {
    const resolved = await resolveManifestSourcePath(manifestFile, cwd, paths.rootDir);
    if ('warning' in resolved) {
      warnings.push(`⚠️ ${resolved.warning}`);
      continue;
    }

    const filename = path.basename(resolved.filePath);
    const relativePath = allocateOutgoingRelativePath(filename, usedPaths);
    const storedPath = path.join(paths.rootDir, relativePath);

    const sourceStats = await stat(resolved.filePath);
    if (sourceStats.size > config.maxAttachmentSizeBytes) {
      warnings.push(
        `⚠️ Skipped artifact \`${manifestFile.path}\`: file exceeds max size of ${config.maxAttachmentSizeBytes} bytes.`,
      );
      continue;
    }

    await copyFile(resolved.filePath, storedPath);

    const stats = await stat(storedPath);
    const record: ArtifactRecord = {
      id: randomUUID(),
      filename,
      relativePath,
      mimeType: manifestFile.mimeType,
      size: stats.size,
      kind: inferArtifactKind(filename, manifestFile.mimeType),
      createdAt,
      sourceMessageId,
      title: manifestFile.title,
    };

    outgoingRecords.push(record);
    uploadedFiles.push(storedPath);
  }

  if (outgoingRecords.length > 0) {
    await persistConversationArtifactMetadata(conversationId, {
      incoming: existingMetadata.incoming,
      outgoing: [...existingMetadata.outgoing, ...outgoingRecords],
      lastUpdatedAt: createdAt,
    });

    try {
      await channel.send({
        content: `📎 Returned ${uploadedFiles.length} file${uploadedFiles.length > 1 ? 's' : ''}.`,
        files: uploadedFiles,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`⚠️ Failed to upload returned files: ${message}`);
    }
  }

  if (warnings.length > 0) {
    await channel.send(warnings.join('\n'));
  }
}
