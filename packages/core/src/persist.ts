import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from './config.js';
import type { BackendName } from './agent/backend.js';
import type {
  ThreadContinuationSnapshot,
  ThreadContinuationStopReason,
  ThreadNativeSessionStatus,
  ThreadSessionBinding,
} from './thread-session/types.js';

interface PersistedState {
  sessions: Record<string, string>;
  models: Record<string, string>;
  effort: Record<string, string>;
  cwd: Record<string, string>;
  backend: Record<string, string>;
  threadSessionBindings?: Record<string, ThreadSessionBinding>;
  threadContinuationSnapshots?: Record<string, ThreadContinuationSnapshot>;
  savedCwdList: string[];
}

const nativeSessionStatuses = new Set<ThreadNativeSessionStatus>(['pending', 'confirmed', 'invalid']);
const continuationStopReasons = new Set<ThreadContinuationStopReason>(['timeout', 'interrupted', 'error', 'completed']);

function populateMap(map: Map<string, string>, record: unknown): void {
  if (typeof record !== 'object' || record === null) return;
  for (const [k, v] of Object.entries(record as Record<string, unknown>)) {
    if (typeof v === 'string') map.set(k, v);
  }
}

function readThreadSessionBinding(record: unknown): ThreadSessionBinding | null {
  if (typeof record !== 'object' || record === null) {
    return null;
  }

  const value = record as Record<string, unknown>;
  if (
    typeof value['conversationId'] !== 'string'
    || typeof value['backend'] !== 'string'
    || typeof value['lastSeenAt'] !== 'string'
    || !nativeSessionStatuses.has(value['nativeSessionStatus'] as ThreadNativeSessionStatus)
  ) {
    return null;
  }

  const nativeSessionId = value['nativeSessionId'];
  const closedAt = value['closedAt'];

  if (nativeSessionId !== undefined && typeof nativeSessionId !== 'string') {
    return null;
  }

  if (closedAt !== undefined && typeof closedAt !== 'string') {
    return null;
  }

  return {
    conversationId: value['conversationId'],
    backend: value['backend'] as BackendName,
    nativeSessionId: nativeSessionId as string | undefined,
    nativeSessionStatus: value['nativeSessionStatus'] as ThreadNativeSessionStatus,
    lastSeenAt: value['lastSeenAt'],
    closedAt: closedAt as string | undefined,
  };
}

function populateThreadSessionBindings(
  bindings: Map<string, ThreadSessionBinding>,
  record: unknown,
): void {
  if (typeof record !== 'object' || record === null) {
    return;
  }

  for (const [conversationId, value] of Object.entries(record as Record<string, unknown>)) {
    const binding = readThreadSessionBinding(value);
    if (binding && binding.conversationId === conversationId) {
      bindings.set(conversationId, binding);
    }
  }
}

function readThreadContinuationSnapshot(record: unknown): ThreadContinuationSnapshot | null {
  if (typeof record !== 'object' || record === null) {
    return null;
  }

  const value = record as Record<string, unknown>;
  if (
    typeof value['conversationId'] !== 'string'
    || typeof value['taskSummary'] !== 'string'
    || typeof value['updatedAt'] !== 'string'
    || !continuationStopReasons.has(value['whyStopped'] as ThreadContinuationStopReason)
  ) {
    return null;
  }

  const optionalKeys = ['lastKnownCwd', 'model', 'effort', 'nextStep'] as const;
  for (const key of optionalKeys) {
    const candidate = value[key];
    if (candidate !== undefined && typeof candidate !== 'string') {
      return null;
    }
  }

  return {
    conversationId: value['conversationId'],
    taskSummary: value['taskSummary'],
    lastKnownCwd: value['lastKnownCwd'] as string | undefined,
    model: value['model'] as string | undefined,
    effort: value['effort'] as string | undefined,
    whyStopped: value['whyStopped'] as ThreadContinuationStopReason,
    nextStep: value['nextStep'] as string | undefined,
    updatedAt: value['updatedAt'],
  };
}

function populateThreadContinuationSnapshots(
  snapshots: Map<string, ThreadContinuationSnapshot>,
  record: unknown,
): void {
  if (typeof record !== 'object' || record === null) {
    return;
  }

  for (const [conversationId, value] of Object.entries(record as Record<string, unknown>)) {
    const snapshot = readThreadContinuationSnapshot(value);
    if (snapshot && snapshot.conversationId === conversationId) {
      snapshots.set(conversationId, snapshot);
    }
  }
}

export async function loadState(
  sessions: Map<string, string>,
  models: Map<string, string>,
  effort: Map<string, string>,
  cwd: Map<string, string>,
  backend: Map<string, string>,
  threadSessionBindings: Map<string, ThreadSessionBinding>,
  threadContinuationSnapshots: Map<string, ThreadContinuationSnapshot>,
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
    populateThreadSessionBindings(threadSessionBindings, parsed.threadSessionBindings ?? {});
    populateThreadContinuationSnapshots(
      threadContinuationSnapshots,
      parsed.threadContinuationSnapshots ?? {},
    );
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
  threadSessionBindings: Map<string, ThreadSessionBinding>,
  threadContinuationSnapshots: Map<string, ThreadContinuationSnapshot>,
  savedCwdList: string[],
): Promise<void> {
  const data: PersistedState = {
    sessions: Object.fromEntries(sessions),
    models: Object.fromEntries(models),
    effort: Object.fromEntries(effort),
    cwd: Object.fromEntries(cwd),
    backend: Object.fromEntries(backend),
    threadSessionBindings: Object.fromEntries(threadSessionBindings),
    threadContinuationSnapshots: Object.fromEntries(threadContinuationSnapshots),
    savedCwdList,
  };
  try {
    await mkdir(dirname(config.stateFile), { recursive: true });
    await writeFile(config.stateFile, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[state] Failed to save state:', err);
  }
}
