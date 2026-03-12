import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface SlackConversationRecord {
  conversationId: string;
  channelId: string;
  threadTs: string;
  rootMessageTs: string;
  statusMessageTs?: string;
}

export interface SlackTriggerContext {
  channelId: string;
}

type PendingInteractiveRequest = {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const conversations = new Map<string, SlackConversationRecord>();
const threadConversationIds = new Map<string, string>();
const triggerContexts = new Map<string, SlackTriggerContext>();
const interactiveRequests = new Map<string, PendingInteractiveRequest>();

function indexConversation(record: SlackConversationRecord): void {
  conversations.set(record.conversationId, record);
  threadConversationIds.set(record.threadTs, record.conversationId);
}

export function rememberSlackConversation(record: SlackConversationRecord): void {
  indexConversation(record);
}

export function getSlackConversation(conversationId: string): SlackConversationRecord | undefined {
  return conversations.get(conversationId);
}

export function findSlackConversationByThreadTs(threadTs: string): SlackConversationRecord | undefined {
  const conversationId = threadConversationIds.get(threadTs);
  return conversationId ? conversations.get(conversationId) : undefined;
}

export function updateSlackStatusMessageTs(conversationId: string, statusMessageTs: string): void {
  const existing = conversations.get(conversationId);
  if (!existing) {
    return;
  }

  indexConversation({
    ...existing,
    statusMessageTs,
  });
}

export function registerSlackTriggerContext(triggerMessageId: string, context: SlackTriggerContext): void {
  triggerContexts.set(triggerMessageId, context);
}

export function consumeSlackTriggerContext(triggerMessageId: string): SlackTriggerContext | undefined {
  const context = triggerContexts.get(triggerMessageId);
  triggerContexts.delete(triggerMessageId);
  return context;
}

export function waitForSlackInteractiveValue(
  conversationId: string,
  timeoutMs: number = 60_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      interactiveRequests.delete(conversationId);
      reject(new Error('Slack interactive request timed out.'));
    }, timeoutMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }

    interactiveRequests.set(conversationId, { resolve, reject, timer });
  });
}

export function resolveSlackInteractiveValue(conversationId: string, value: string): boolean {
  const request = interactiveRequests.get(conversationId);
  if (!request) {
    return false;
  }

  interactiveRequests.delete(conversationId);
  clearTimeout(request.timer);
  request.resolve(value);
  return true;
}

export async function persistSlackConversationState(stateFile: string): Promise<void> {
  await mkdir(dirname(stateFile), { recursive: true });
  const payload = {
    conversations: Object.fromEntries(
      [...conversations.entries()].map(([conversationId, record]) => [
        conversationId,
        {
          channelId: record.channelId,
          threadTs: record.threadTs,
          rootMessageTs: record.rootMessageTs,
          ...(record.statusMessageTs ? { statusMessageTs: record.statusMessageTs } : {}),
        },
      ]),
    ),
  };

  await writeFile(stateFile, JSON.stringify(payload, null, 2), 'utf-8');
}

export async function loadSlackConversationState(stateFile: string): Promise<void> {
  const raw = await readFile(stateFile, 'utf-8');
  const parsed = JSON.parse(raw) as {
    conversations?: Record<string, Omit<SlackConversationRecord, 'conversationId'>>;
  };

  for (const [conversationId, record] of Object.entries(parsed.conversations ?? {})) {
    if (
      typeof record?.channelId !== 'string'
      || typeof record.threadTs !== 'string'
      || typeof record.rootMessageTs !== 'string'
    ) {
      continue;
    }

    indexConversation({
      conversationId,
      channelId: record.channelId,
      threadTs: record.threadTs,
      rootMessageTs: record.rootMessageTs,
      statusMessageTs: typeof record.statusMessageTs === 'string' ? record.statusMessageTs : undefined,
    });
  }
}

export function resetSlackStateForTests(): void {
  for (const request of interactiveRequests.values()) {
    clearTimeout(request.timer);
    request.reject(new Error('Slack interactive request reset.'));
  }
  conversations.clear();
  threadConversationIds.clear();
  triggerContexts.clear();
  interactiveRequests.clear();
}
