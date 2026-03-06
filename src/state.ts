import { loadState, saveState } from './persist.js';

export const threadSessions = new Map<string, string>();
export const threadModels = new Map<string, string>();
export const threadEffort = new Map<string, string>();
export const threadCwd = new Map<string, string>();
export const activeThreads = new Set<string>();
export const processedMessages = new Set<string>();
export const pendingThreadCreation = new Set<string>();

export async function initState(): Promise<void> {
  await loadState(threadSessions, threadModels, threadEffort, threadCwd);
}

export async function persistState(): Promise<void> {
  await saveState(threadSessions, threadModels, threadEffort, threadCwd);
}
