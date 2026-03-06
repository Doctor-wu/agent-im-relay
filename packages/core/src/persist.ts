import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from './config.js';

interface PersistedState {
  sessions: Record<string, string>;
  models: Record<string, string>;
  effort: Record<string, string>;
  cwd: Record<string, string>;
  backend: Record<string, string>;
  savedCwdList: string[];
}

function populateMap(map: Map<string, string>, record: unknown): void {
  if (typeof record !== 'object' || record === null) return;
  for (const [k, v] of Object.entries(record as Record<string, unknown>)) {
    if (typeof v === 'string') map.set(k, v);
  }
}

export async function loadState(
  sessions: Map<string, string>,
  models: Map<string, string>,
  effort: Map<string, string>,
  cwd: Map<string, string>,
  backend: Map<string, string>,
  savedCwdList: string[],
): Promise<void> {
  try {
    const raw = await readFile(config.stateFile, 'utf-8');
    const parsed: PersistedState = JSON.parse(raw) as PersistedState;
    // Support both old (threadSessions) and new (sessions) keys
    populateMap(sessions, parsed.sessions ?? (parsed as any).threadSessions);
    populateMap(models, parsed.models ?? (parsed as any).threadModels);
    populateMap(effort, parsed.effort ?? (parsed as any).threadEffort);
    populateMap(cwd, parsed.cwd ?? (parsed as any).threadCwd);
    populateMap(backend, parsed.backend ?? {});
    const cwds = Array.isArray(parsed.savedCwdList) ? parsed.savedCwdList : [];
    savedCwdList.push(...cwds.filter((v): v is string => typeof v === 'string'));
    console.log(`[state] Loaded ${sessions.size} session(s) from ${config.stateFile}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[state] Could not load persisted state:', err);
    }
  }
}

export async function saveState(
  sessions: Map<string, string>,
  models: Map<string, string>,
  effort: Map<string, string>,
  cwd: Map<string, string>,
  backend: Map<string, string>,
  savedCwdList: string[],
): Promise<void> {
  const data: PersistedState = {
    sessions: Object.fromEntries(sessions),
    models: Object.fromEntries(models),
    effort: Object.fromEntries(effort),
    cwd: Object.fromEntries(cwd),
    backend: Object.fromEntries(backend),
    savedCwdList,
  };
  try {
    await mkdir(dirname(config.stateFile), { recursive: true });
    await writeFile(config.stateFile, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[state] Failed to save state:', err);
  }
}
