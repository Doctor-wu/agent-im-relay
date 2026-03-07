import type { BackendName } from './agent/backend.js';
import {
  createEmptyArtifactMetadata,
  ensureConversationArtifactPaths,
  getConversationArtifactPaths,
  readArtifactMetadata,
  writeArtifactMetadata,
} from './artifacts/store.js';
import type { ConversationArtifactMetadata } from './artifacts/types.js';
import { loadState, saveState } from './persist.js';

// Generalized keys: "conversation" instead of "thread"
export const conversationSessions = new Map<string, string>();
export const conversationModels = new Map<string, string>();
export const conversationEffort = new Map<string, string>();
export const conversationCwd = new Map<string, string>();
export const conversationBackend = new Map<string, BackendName>();
export const conversationMode = new Map<string, 'code' | 'ask'>();
export const conversationArtifacts = new Map<string, ConversationArtifactMetadata>();
export const savedCwdList: string[] = [];
export const activeConversations = new Set<string>();
export const processedMessages = new Set<string>();
export const processedEventIds = new Set<string>();
export const pendingConversationCreation = new Set<string>();
export const pendingBackendChanges = new Map<string, BackendName>();

function cloneArtifactMetadata(metadata: ConversationArtifactMetadata): ConversationArtifactMetadata {
  return {
    incoming: [...metadata.incoming],
    outgoing: [...metadata.outgoing],
    lastUpdatedAt: metadata.lastUpdatedAt,
  };
}

function trackedConversationIds(): string[] {
  return [...new Set([
    ...conversationSessions.keys(),
    ...conversationModels.keys(),
    ...conversationEffort.keys(),
    ...conversationCwd.keys(),
    ...conversationBackend.keys(),
    ...conversationMode.keys(),
    ...pendingBackendChanges.keys(),
  ])];
}

async function loadConversationArtifactMetadata(
  conversationId: string,
): Promise<ConversationArtifactMetadata> {
  const metadata = cloneArtifactMetadata(await readArtifactMetadata(getConversationArtifactPaths(conversationId)));
  conversationArtifacts.set(conversationId, metadata);
  return metadata;
}

export async function getConversationArtifactMetadata(
  conversationId: string,
): Promise<ConversationArtifactMetadata> {
  const cached = conversationArtifacts.get(conversationId);
  if (cached) {
    return cloneArtifactMetadata(cached);
  }

  return loadConversationArtifactMetadata(conversationId);
}

export async function persistConversationArtifactMetadata(
  conversationId: string,
  metadata: ConversationArtifactMetadata,
): Promise<ConversationArtifactMetadata> {
  const normalized = cloneArtifactMetadata(metadata);
  await writeArtifactMetadata(await ensureConversationArtifactPaths(conversationId), normalized);
  conversationArtifacts.set(conversationId, normalized);
  return cloneArtifactMetadata(normalized);
}

export async function initState(): Promise<void> {
  await loadState(conversationSessions, conversationModels, conversationEffort, conversationCwd, conversationBackend, savedCwdList);
  await Promise.all(trackedConversationIds().map(async (conversationId) => {
    try {
      await loadConversationArtifactMetadata(conversationId);
    } catch (error) {
      console.warn(`[artifacts] Could not load metadata for ${conversationId}:`, error);
      conversationArtifacts.set(conversationId, createEmptyArtifactMetadata());
    }
  }));
}

export async function persistState(): Promise<void> {
  await saveState(conversationSessions, conversationModels, conversationEffort, conversationCwd, conversationBackend, savedCwdList);
}
