import type { BackendName } from './agent/backend.js';
import { loadState, saveState } from './persist.js';

// Generalized keys: "conversation" instead of "thread"
export const conversationSessions = new Map<string, string>();
export const conversationModels = new Map<string, string>();
export const conversationEffort = new Map<string, string>();
export const conversationCwd = new Map<string, string>();
export const conversationBackend = new Map<string, BackendName>();
export const savedCwdList: string[] = [];
export const activeConversations = new Set<string>();
export const processedMessages = new Set<string>();
export const pendingConversationCreation = new Set<string>();

export async function initState(): Promise<void> {
  await loadState(conversationSessions, conversationModels, conversationEffort, conversationCwd, conversationBackend, savedCwdList);
}

export async function persistState(): Promise<void> {
  await saveState(conversationSessions, conversationModels, conversationEffort, conversationCwd, conversationBackend, savedCwdList);
}
