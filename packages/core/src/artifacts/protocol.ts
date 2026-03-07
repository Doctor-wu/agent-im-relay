import path from 'node:path';
import type { ArtifactManifest, ArtifactManifestFile } from './types.js';

const ARTIFACT_BLOCK_PATTERN = /```artifacts\s*([\s\S]*?)```/g;

function normalizeArtifactManifestFile(value: unknown): ArtifactManifestFile | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const filePath = typeof record.path === 'string' ? record.path.trim() : '';
  if (!filePath) {
    return null;
  }

  const manifestFile: ArtifactManifestFile = { path: filePath };
  if (typeof record.title === 'string' && record.title.trim()) {
    manifestFile.title = record.title.trim();
  }
  if (typeof record.mimeType === 'string' && record.mimeType.trim()) {
    manifestFile.mimeType = record.mimeType.trim();
  }

  return manifestFile;
}

function normalizeArtifactManifest(value: unknown): ArtifactManifest | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.files)) {
    return null;
  }

  const files = record.files
    .map(normalizeArtifactManifestFile)
    .filter((file): file is ArtifactManifestFile => file !== null);

  return files.length > 0 ? { files } : null;
}

export function parseArtifactManifest(text: string): ArtifactManifest | null {
  let lastValidManifest: ArtifactManifest | null = null;

  for (const match of text.matchAll(ARTIFACT_BLOCK_PATTERN)) {
    const blockContent = match[1]?.trim();
    if (!blockContent) {
      continue;
    }

    try {
      const parsed = JSON.parse(blockContent) as unknown;
      const manifest = normalizeArtifactManifest(parsed);
      if (manifest) {
        lastValidManifest = manifest;
      }
    } catch {
      continue;
    }
  }

  return lastValidManifest;
}

export function stripArtifactManifest(text: string): string {
  return text
    .replace(ARTIFACT_BLOCK_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function resolveArtifactPath(rootDir: string, artifactPath: string): string {
  const normalizedPath = artifactPath.trim();
  if (!normalizedPath || path.isAbsolute(normalizedPath)) {
    throw new Error('Artifact path must stay within the allowed root');
  }

  const resolvedPath = path.resolve(rootDir, normalizedPath);
  const relativePath = path.relative(rootDir, resolvedPath);
  if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error('Artifact path must stay within the allowed root');
  }

  return resolvedPath;
}

export function resolveArtifactCandidatePaths(rootDirs: string[], artifactPath: string): string[] {
  const candidates: string[] = [];

  for (const rootDir of rootDirs) {
    try {
      candidates.push(resolveArtifactPath(rootDir, artifactPath));
    } catch {
      // Ignore roots that do not allow this relative path.
    }
  }

  return candidates;
}
