import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { ArtifactRecord, ConversationArtifactMetadata, ConversationArtifactPaths } from './types.js';

function normalizeArtifactRecord(value: unknown): ArtifactRecord | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string'
    || typeof record.filename !== 'string'
    || typeof record.relativePath !== 'string'
    || typeof record.size !== 'number'
    || typeof record.kind !== 'string'
    || typeof record.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: record.id,
    filename: record.filename,
    relativePath: record.relativePath,
    mimeType: typeof record.mimeType === 'string' ? record.mimeType : undefined,
    size: record.size,
    kind: record.kind as ArtifactRecord['kind'],
    createdAt: record.createdAt,
    sourceMessageId: typeof record.sourceMessageId === 'string' ? record.sourceMessageId : undefined,
    sha256: typeof record.sha256 === 'string' ? record.sha256 : undefined,
    preview: Array.isArray(record.preview) ? record.preview.filter((line): line is string => typeof line === 'string') : undefined,
    title: typeof record.title === 'string' ? record.title : undefined,
  };
}

function normalizeArtifactList(value: unknown): ArtifactRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeArtifactRecord)
    .filter((record): record is ArtifactRecord => record !== null);
}

export function createEmptyArtifactMetadata(): ConversationArtifactMetadata {
  return {
    incoming: [],
    outgoing: [],
    lastUpdatedAt: null,
  };
}

export function cloneConversationArtifactMetadata(
  metadata: ConversationArtifactMetadata,
): ConversationArtifactMetadata {
  return {
    incoming: [...metadata.incoming],
    outgoing: [...metadata.outgoing],
    lastUpdatedAt: metadata.lastUpdatedAt,
  };
}

export function getConversationArtifactPaths(conversationId: string): ConversationArtifactPaths {
  const rootDir = path.join(config.artifactsBaseDir, conversationId);
  return {
    conversationId,
    rootDir,
    incomingDir: path.join(rootDir, 'incoming'),
    outgoingDir: path.join(rootDir, 'outgoing'),
    metaFile: path.join(rootDir, 'meta.json'),
  };
}

async function cleanupExpiredArtifactDirectories(): Promise<void> {
  const cutoff = Date.now() - (config.artifactRetentionDays * 24 * 60 * 60 * 1000);

  try {
    const entries = await readdir(config.artifactsBaseDir, { withFileTypes: true });

    await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory()) {
        return;
      }

      const entryPath = path.join(config.artifactsBaseDir, entry.name);
      const entryStats = await stat(entryPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return null;
        }
        throw error;
      });

      if (!entryStats || entryStats.mtimeMs >= cutoff) {
        return;
      }

      await rm(entryPath, { recursive: true, force: true });
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

function normalizeArtifactMetadata(value: unknown): ConversationArtifactMetadata {
  if (typeof value !== 'object' || value === null) {
    return createEmptyArtifactMetadata();
  }

  const record = value as Record<string, unknown>;
  return {
    incoming: normalizeArtifactList(record.incoming),
    outgoing: normalizeArtifactList(record.outgoing),
    lastUpdatedAt: typeof record.lastUpdatedAt === 'string' ? record.lastUpdatedAt : null,
  };
}

export async function ensureConversationArtifactPaths(conversationId: string): Promise<ConversationArtifactPaths> {
  await cleanupExpiredArtifactDirectories();
  const paths = getConversationArtifactPaths(conversationId);

  await Promise.all([
    mkdir(paths.incomingDir, { recursive: true }),
    mkdir(paths.outgoingDir, { recursive: true }),
  ]);

  return paths;
}

export async function readArtifactMetadata(paths: ConversationArtifactPaths): Promise<ConversationArtifactMetadata> {
  await cleanupExpiredArtifactDirectories();
  try {
    const raw = await readFile(paths.metaFile, 'utf-8');
    return normalizeArtifactMetadata(JSON.parse(raw) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createEmptyArtifactMetadata();
    }
    throw error;
  }
}

export async function writeArtifactMetadata(
  paths: ConversationArtifactPaths,
  metadata: ConversationArtifactMetadata,
): Promise<void> {
  await mkdir(paths.rootDir, { recursive: true });
  await writeFile(paths.metaFile, JSON.stringify(normalizeArtifactMetadata(metadata), null, 2), 'utf-8');
}
