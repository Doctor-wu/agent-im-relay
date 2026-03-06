import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from './config.js';

interface PersistedState {
  threadSessions: Record<string, string>;
  threadModels: Record<string, string>;
  threadEffort: Record<string, string>;
  threadCwd: Record<string, string>;
}

function populateMap(map: Map<string, string>, record: unknown): void {
  if (typeof record !== 'object' || record === null) return;
  for (const [k, v] of Object.entries(record as Record<string, unknown>)) {
    if (typeof v === 'string') map.set(k, v);
  }
}

export async function loadState(
  threadSessions: Map<string, string>,
  threadModels: Map<string, string>,
  threadEffort: Map<string, string>,
  threadCwd: Map<string, string>,
): Promise<void> {
  try {
    const raw = await readFile(config.stateFile, 'utf-8');
    const parsed: PersistedState = JSON.parse(raw) as PersistedState;
    populateMap(threadSessions, parsed.threadSessions);
    populateMap(threadModels, parsed.threadModels);
    populateMap(threadEffort, parsed.threadEffort);
    populateMap(threadCwd, parsed.threadCwd);
    console.log(`[state] Loaded ${threadSessions.size} session(s) from ${config.stateFile}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[state] Could not load persisted state:', err);
    }
  }
}

export async function saveState(
  threadSessions: Map<string, string>,
  threadModels: Map<string, string>,
  threadEffort: Map<string, string>,
  threadCwd: Map<string, string>,
): Promise<void> {
  const data: PersistedState = {
    threadSessions: Object.fromEntries(threadSessions),
    threadModels: Object.fromEntries(threadModels),
    threadEffort: Object.fromEntries(threadEffort),
    threadCwd: Object.fromEntries(threadCwd),
  };
  try {
    await mkdir(dirname(config.stateFile), { recursive: true });
    await writeFile(config.stateFile, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[state] Failed to save state:', err);
  }
}
