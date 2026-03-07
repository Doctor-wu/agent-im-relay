import { conversationSessions, threadContinuationSnapshots, threadSessionBindings } from '../state.js';
import type {
  ThreadContinuationSnapshot,
  ThreadResumeMode,
  ThreadSessionBinding,
} from './types.js';

function resolveTimestamp(now?: string): string {
  return now ?? new Date().toISOString();
}

function requireThreadSessionBinding(conversationId: string): ThreadSessionBinding {
  const binding = threadSessionBindings.get(conversationId);
  if (!binding) {
    throw new Error(`No thread session binding found for conversation ${conversationId}`);
  }

  return binding;
}

export function openThreadSessionBinding(
  input: Pick<ThreadSessionBinding, 'conversationId' | 'backend'> & { now?: string },
): ThreadSessionBinding {
  const existing = threadSessionBindings.get(input.conversationId);
  const lastSeenAt = resolveTimestamp(input.now);

  if (existing && !existing.closedAt) {
    if (existing.nativeSessionStatus === 'confirmed' && existing.nativeSessionId) {
      conversationSessions.set(input.conversationId, existing.nativeSessionId);
    } else {
      conversationSessions.delete(input.conversationId);
    }

    const binding = {
      ...existing,
      backend: input.backend,
      lastSeenAt,
    } satisfies ThreadSessionBinding;
    threadSessionBindings.set(input.conversationId, binding);
    return binding;
  }

  const binding = {
    conversationId: input.conversationId,
    backend: input.backend,
    nativeSessionStatus: 'pending',
    lastSeenAt,
  } satisfies ThreadSessionBinding;

  conversationSessions.delete(input.conversationId);
  threadSessionBindings.set(input.conversationId, binding);
  return binding;
}

export function confirmThreadSessionBinding(
  input: Pick<ThreadSessionBinding, 'conversationId' | 'nativeSessionId'> & { now?: string },
): ThreadSessionBinding {
  const existing = requireThreadSessionBinding(input.conversationId);
  const binding = {
    ...existing,
    nativeSessionId: input.nativeSessionId,
    nativeSessionStatus: 'confirmed',
    lastSeenAt: resolveTimestamp(input.now),
    closedAt: undefined,
  } satisfies ThreadSessionBinding;

  threadSessionBindings.set(input.conversationId, binding);
  conversationSessions.set(input.conversationId, input.nativeSessionId);
  return binding;
}

export function invalidateThreadSessionBinding(
  input: Pick<ThreadSessionBinding, 'conversationId'> & { now?: string },
): ThreadSessionBinding {
  const existing = requireThreadSessionBinding(input.conversationId);
  const binding = {
    ...existing,
    nativeSessionStatus: 'invalid',
    lastSeenAt: resolveTimestamp(input.now),
  } satisfies ThreadSessionBinding;

  threadSessionBindings.set(input.conversationId, binding);
  conversationSessions.delete(input.conversationId);
  return binding;
}

export function updateThreadContinuationSnapshot(
  snapshot: ThreadContinuationSnapshot,
): ThreadContinuationSnapshot {
  const normalized = { ...snapshot } satisfies ThreadContinuationSnapshot;
  threadContinuationSnapshots.set(snapshot.conversationId, normalized);
  return normalized;
}

export function closeThreadSession(
  input: Pick<ThreadSessionBinding, 'conversationId'> & { now?: string },
): { bindingCleared: boolean; snapshotCleared: boolean; sessionCleared: boolean } {
  void input.now;

  const bindingCleared = threadSessionBindings.delete(input.conversationId);
  const snapshotCleared = threadContinuationSnapshots.delete(input.conversationId);
  const sessionCleared = conversationSessions.delete(input.conversationId);

  return { bindingCleared, snapshotCleared, sessionCleared };
}

export function resolveThreadResumeMode(conversationId: string): ThreadResumeMode {
  const binding = threadSessionBindings.get(conversationId);
  if (!binding) {
    return { type: 'fresh-start' };
  }

  if (binding.nativeSessionStatus === 'confirmed' && binding.nativeSessionId) {
    return {
      type: 'native-resume',
      binding,
      nativeSessionId: binding.nativeSessionId,
    };
  }

  const snapshot = threadContinuationSnapshots.get(conversationId);
  if (snapshot) {
    return {
      type: 'snapshot-resume',
      binding,
      snapshot,
    };
  }

  return { type: 'fresh-start' };
}
