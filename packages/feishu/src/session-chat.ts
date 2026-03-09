import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveFeishuSessionChatStateFile } from './config.js';

const sessionChats = new Map<string, FeishuSessionChatRecord>();
let initializedStatePath: string | null = null;

const PROMPT_PREVIEW_LIMIT = 120;

export interface FeishuSessionChatRecord {
  sourceP2pChatId: string;
  sourceMessageId: string;
  sessionChatId: string;
  creatorOpenId: string;
  createdAt: string;
  promptPreview: string;
  anchorMessageId?: string;
  lastKnownBackend?: string;
  lastKnownModel?: string;
  lastKnownEffort?: string;
  lastRunStatus?: 'idle' | 'running';
}

export type FeishuSessionChatUpdate = Partial<Pick<
  FeishuSessionChatRecord,
  'anchorMessageId' | 'lastKnownBackend' | 'lastKnownModel' | 'lastKnownEffort' | 'lastRunStatus'
>>;

export type FeishuChatSessionKind =
  | {
    kind: 'private-launcher';
    chatId: string;
  }
  | {
    kind: 'session-chat';
    chatId: string;
    record: FeishuSessionChatRecord;
  }
  | {
    kind: 'group';
    chatId: string;
  };

type PersistedFeishuSessionChats = {
  sessionChats: Record<string, FeishuSessionChatRecord>;
};

function normalizePromptPreview(prompt: string): string {
  return prompt.trim().replace(/\s+/g, ' ').slice(0, PROMPT_PREVIEW_LIMIT);
}

function readFeishuSessionChatRecord(value: unknown): FeishuSessionChatRecord | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const requiredKeys = [
    'sourceP2pChatId',
    'sourceMessageId',
    'sessionChatId',
    'creatorOpenId',
    'createdAt',
    'promptPreview',
  ] as const;

  for (const key of requiredKeys) {
    if (typeof record[key] !== 'string') {
      return null;
    }
  }

  return {
    sourceP2pChatId: record.sourceP2pChatId,
    sourceMessageId: record.sourceMessageId,
    sessionChatId: record.sessionChatId,
    creatorOpenId: record.creatorOpenId,
    createdAt: record.createdAt,
    promptPreview: record.promptPreview,
    ...(typeof record.anchorMessageId === 'string' ? { anchorMessageId: record.anchorMessageId } : {}),
    ...(typeof record.lastKnownBackend === 'string' ? { lastKnownBackend: record.lastKnownBackend } : {}),
    ...(typeof record.lastKnownModel === 'string' ? { lastKnownModel: record.lastKnownModel } : {}),
    ...(typeof record.lastKnownEffort === 'string' ? { lastKnownEffort: record.lastKnownEffort } : {}),
    ...(record.lastRunStatus === 'idle' || record.lastRunStatus === 'running'
      ? { lastRunStatus: record.lastRunStatus }
      : {}),
  };
}

function populateFeishuSessionChats(record: unknown): void {
  if (typeof record !== 'object' || record === null) {
    return;
  }

  for (const [sessionChatId, value] of Object.entries(record as Record<string, unknown>)) {
    const sessionChat = readFeishuSessionChatRecord(value);
    if (sessionChat && sessionChat.sessionChatId === sessionChatId) {
      sessionChats.set(sessionChatId, sessionChat);
    }
  }
}

export function buildFeishuSessionChatRecord(input: {
  sourceP2pChatId: string;
  sourceMessageId: string;
  sessionChatId: string;
  creatorOpenId: string;
  createdAt?: string;
  prompt: string;
}): FeishuSessionChatRecord {
  return {
    sourceP2pChatId: input.sourceP2pChatId,
    sourceMessageId: input.sourceMessageId,
    sessionChatId: input.sessionChatId,
    creatorOpenId: input.creatorOpenId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    promptPreview: normalizePromptPreview(input.prompt),
  };
}

export function rememberFeishuSessionChat(record: FeishuSessionChatRecord): void {
  sessionChats.set(record.sessionChatId, record);
}

export function getFeishuSessionChat(sessionChatId: string): FeishuSessionChatRecord | undefined {
  return sessionChats.get(sessionChatId);
}

export function findFeishuSessionChatBySourceMessage(input: {
  sourceP2pChatId: string;
  sourceMessageId: string;
}): FeishuSessionChatRecord | undefined {
  for (const record of sessionChats.values()) {
    if (
      record.sourceP2pChatId === input.sourceP2pChatId
      && record.sourceMessageId === input.sourceMessageId
    ) {
      return record;
    }
  }

  return undefined;
}

export function updateFeishuSessionChat(
  sessionChatId: string,
  updates: FeishuSessionChatUpdate,
): FeishuSessionChatRecord | undefined {
  const current = sessionChats.get(sessionChatId);
  if (!current) {
    return undefined;
  }

  const next = {
    ...current,
    ...updates,
  } satisfies FeishuSessionChatRecord;
  sessionChats.set(sessionChatId, next);
  return next;
}

export async function initializeFeishuSessionChats(stateFile: string): Promise<void> {
  const statePath = resolveFeishuSessionChatStateFile(stateFile);
  if (initializedStatePath === statePath) {
    return;
  }

  sessionChats.clear();

  try {
    const raw = await readFile(statePath, 'utf-8');
    const parsed = JSON.parse(raw) as PersistedFeishuSessionChats;
    populateFeishuSessionChats(parsed.sessionChats ?? {});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[feishu] Could not load session-chat state:', error);
    }
  }

  initializedStatePath = statePath;
}

export async function persistFeishuSessionChats(stateFile: string): Promise<void> {
  const statePath = resolveFeishuSessionChatStateFile(stateFile);
  const data: PersistedFeishuSessionChats = {
    sessionChats: Object.fromEntries(sessionChats),
  };

  await mkdir(dirname(statePath), { recursive: true });
  const tempFile = `${statePath}.${randomUUID()}.tmp`;
  await writeFile(tempFile, JSON.stringify(data, null, 2), 'utf-8');
  await rename(tempFile, statePath);
  initializedStatePath = statePath;
}

export function resolveFeishuChatSessionKind(input: {
  chatId: string;
  chatType?: string;
}): FeishuChatSessionKind {
  if (input.chatType === 'p2p') {
    return {
      kind: 'private-launcher',
      chatId: input.chatId,
    };
  }

  const record = getFeishuSessionChat(input.chatId);
  if (record) {
    return {
      kind: 'session-chat',
      chatId: input.chatId,
      record,
    };
  }

  return {
    kind: 'group',
    chatId: input.chatId,
  };
}

export function resetFeishuSessionChatsForTests(): void {
  sessionChats.clear();
  initializedStatePath = null;
}
