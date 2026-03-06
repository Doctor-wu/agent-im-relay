export type ArtifactKind =
  | 'generic'
  | 'image'
  | 'markdown'
  | 'pdf'
  | 'audio'
  | 'video';

export interface ArtifactRecord {
  id: string;
  filename: string;
  relativePath: string;
  mimeType?: string;
  size: number;
  kind: ArtifactKind;
  createdAt: string;
  sourceMessageId?: string;
  sha256?: string;
  preview?: string[];
  title?: string;
}

export interface ConversationArtifactMetadata {
  incoming: ArtifactRecord[];
  outgoing: ArtifactRecord[];
  lastUpdatedAt: string | null;
}

export interface ConversationArtifactPaths {
  conversationId: string;
  rootDir: string;
  incomingDir: string;
  outgoingDir: string;
  metaFile: string;
}

export interface ArtifactManifestFile {
  path: string;
  title?: string;
  mimeType?: string;
}

export interface ArtifactManifest {
  files: ArtifactManifestFile[];
}
