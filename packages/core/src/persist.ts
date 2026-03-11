import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from './config.js';
import type { BackendName } from './agent/backend.js';
import {
  inferRelayPlatformFromConversationId,
  relayPlatforms,
  type RelayPlatform,
} from './relay-platform.js';
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

interface StateScopeOptions {
  platform?: RelayPlatform;
}

const nativeSessionStatuses = new Set<ThreadNativeSessionStatus>(['pending', 'confirmed', 'invalid']);
const continuationStopReasons = new Set<ThreadContinuationStopReason>(['timeout', 'interrupted', 'error', 'completed']);

function parseScopedConversationKey(
  key: string,
): { platform: RelayPlatform; conversationId: string } | null {
  for (const platform of relayPlatforms) {
    const prefix = `${platform}:`;
    if (key.startsWith(prefix)) {
      return {
        platform,
        conversationId: key.slice(prefix.length),
      };
    }
  }

  return null;
}

function encodeConversationKey(conversationId: string, platform?: RelayPlatform): string {
  return platform ? `${platform}:${conversationId}` : conversationId;
}

function resolveConversationKeyPlatform(key: string): RelayPlatform {
  return parseScopedConversationKey(key)?.platform ?? inferRelayPlatformFromConversationId(key);
}

function decodeConversationKey(key: string, platform?: RelayPlatform): string | null {
  const scopedKey = parseScopedConversationKey(key);
  if (scopedKey) {
    return !platform || scopedKey.platform === platform
      ? scopedKey.conversationId
      : null;
  }

  if (!platform) {
    return key;
  }

  return inferRelayPlatformFromConversationId(key) === platform
    ? key
    : null;
}

function populateScopedMap(
  map: Map<string, string>,
  record: unknown,
  options: StateScopeOptions = {},
): void {
  if (typeof record !== 'object' || record === null) {
    return;
  }

  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    const conversationId = decodeConversationKey(key, options.platform);
    if (conversationId && typeof value === 'string') {
      map.set(conversationId, value);
    }
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
  options: StateScopeOptions = {},
): void {
  if (typeof record !== 'object' || record === null) {
    return;
  }

  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    const conversationId = decodeConversationKey(key, options.platform);
    if (!conversationId) {
      continue;
    }

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
  options: StateScopeOptions = {},
): void {
  if (typeof record !== 'object' || record === null) {
    return;
  }

  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    const conversationId = decodeConversationKey(key, options.platform);
    if (!conversationId) {
      continue;
    }

    const snapshot = readThreadContinuationSnapshot(value);
    if (snapshot && snapshot.conversationId === conversationId) {
      snapshots.set(conversationId, snapshot);
    }
  }
}

function readPersistedStringRecord(record: unknown): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (typeof record !== 'object' || record === null) {
    return normalized;
  }

  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    if (typeof value === 'string') {
      normalized[key] = value;
    }
  }

  return normalized;
}

function readPersistedObjectRecord<T extends object>(record: unknown): Record<string, T> {
  const normalized: Record<string, T> = {};
  if (typeof record !== 'object' || record === null) {
    return normalized;
  }

  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    if (typeof value === 'object' && value !== null) {
      normalized[key] = value as T;
    }
  }

  return normalized;
}

function mergeScopedStringRecord(
  existing: unknown,
  current: Map<string, string>,
  platform: RelayPlatform,
): Record<string, string> {
  const merged = readPersistedStringRecord(existing);

  for (const key of Object.keys(merged)) {
    if (resolveConversationKeyPlatform(key) === platform) {
      delete merged[key];
    }
  }

  for (const [conversationId, value] of current) {
    merged[encodeConversationKey(conversationId, platform)] = value;
  }

  return merged;
}

function mergeScopedObjectRecord<T extends object>(
  existing: unknown,
  current: Map<string, T>,
  platform: RelayPlatform,
): Record<string, T> {
  const merged = readPersistedObjectRecord<T>(existing);

  for (const key of Object.keys(merged)) {
    if (resolveConversationKeyPlatform(key) === platform) {
      delete merged[key];
    }
  }

  for (const [conversationId, value] of current) {
    merged[encodeConversationKey(conversationId, platform)] = value;
  }

  return merged;
}

let writeQueue: Promise<void> = Promise.resolve();

async function readExistingPersistedState(): Promise<Partial<PersistedState>> {
  try {
    const raw = await readFile(config.stateFile, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed === 'object' && parsed !== null
      ? parsed as Partial<PersistedState>
      : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[state] Could not read existing state during scoped save:', error);
    }

    return {};
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
  options: StateScopeOptions = {},
): Promise<void> {
  try {
    const raw = await readFile(config.stateFile, 'utf-8');
    const parsed: PersistedState = JSON.parse(raw) as PersistedState;
    // Support both old (threadSessions) and new (sessions) keys
    populateScopedMap(sessions, parsed.sessions ?? (parsed as any).threadSessions, options);
    populateScopedMap(models, parsed.models ?? (parsed as any).threadModels, options);
    populateScopedMap(effort, parsed.effort ?? (parsed as any).threadEffort, options);
    populateScopedMap(cwd, parsed.cwd ?? (parsed as any).threadCwd, options);
    populateScopedMap(backend, parsed.backend ?? {}, options);
    populateThreadSessionBindings(threadSessionBindings, parsed.threadSessionBindings ?? {}, options);
    populateThreadContinuationSnapshots(
      threadContinuationSnapshots,
      parsed.threadContinuationSnapshots ?? {},
      options,
    );
    const cwds = Array.isArray(parsed.savedCwdList) ? parsed.savedCwdList : [];
    savedCwdList.push(...cwds.filter((v): v is string => typeof v === 'string'));
    console.log(`[state] Loaded ${sessions.size} session(s) from ${config.stateFile}`);
  } catch (err) {
    if (err instanceof SyntaxError) {
      const backupPath = `${config.stateFile}.broken-${Date.now()}`;
      try {
        await mkdir(dirname(config.stateFile), { recursive: true });
        await rename(config.stateFile, backupPath);
        console.warn(`[state] Moved malformed state file to ${backupPath}`);
      } catch (renameError) {
        console.warn('[state] Could not quarantine malformed state file:', renameError);
      }
      return;
    }

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
  options: StateScopeOptions = {},
): Promise<void> {
  const task = writeQueue.then(() => doSaveState(
    sessions, models, effort, cwd, backend,
    threadSessionBindings, threadContinuationSnapshots,
    savedCwdList, options,
  ));
  writeQueue = task.catch(() => {});
  return task;
}

async function doSaveState(
  sessions: Map<string, string>,
  models: Map<string, string>,
  effort: Map<string, string>,
  cwd: Map<string, string>,
  backend: Map<string, string>,
  threadSessionBindings: Map<string, ThreadSessionBinding>,
  threadContinuationSnapshots: Map<string, ThreadContinuationSnapshot>,
  savedCwdList: string[],
  options: StateScopeOptions = {},
): Promise<void> {
  try {
    const existing = options.platform ? await readExistingPersistedState() : {};
    const data: PersistedState = options.platform
      ? {
        sessions: mergeScopedStringRecord(existing.sessions, sessions, options.platform),
        models: mergeScopedStringRecord(existing.models, models, options.platform),
        effort: mergeScopedStringRecord(existing.effort, effort, options.platform),
        cwd: mergeScopedStringRecord(existing.cwd, cwd, options.platform),
        backend: mergeScopedStringRecord(existing.backend, backend, options.platform),
        threadSessionBindings: mergeScopedObjectRecord(
          existing.threadSessionBindings,
          threadSessionBindings,
          options.platform,
        ),
        threadContinuationSnapshots: mergeScopedObjectRecord(
          existing.threadContinuationSnapshots,
          threadContinuationSnapshots,
          options.platform,
        ),
        savedCwdList,
      }
      : {
        sessions: Object.fromEntries(sessions),
        models: Object.fromEntries(models),
        effort: Object.fromEntries(effort),
        cwd: Object.fromEntries(cwd),
        backend: Object.fromEntries(backend),
        threadSessionBindings: Object.fromEntries(threadSessionBindings),
        threadContinuationSnapshots: Object.fromEntries(threadContinuationSnapshots),
        savedCwdList,
      };
    await mkdir(dirname(config.stateFile), { recursive: true });
    const tempFile = `${config.stateFile}.${randomUUID()}.tmp`;
    await writeFile(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tempFile, config.stateFile);
  } catch (err) {
    console.error('[state] Failed to save state:', err);
  }
}
