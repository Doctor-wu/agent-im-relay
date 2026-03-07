import {
  conversationBackend,
  conversationEffort,
  conversationMode,
  conversationModels,
  conversationSessions,
  pendingBackendChanges,
  type BackendName,
} from '@agent-im-relay/core';
import {
  buildSessionControlCard,
  createBackendConfirmationCard,
  createBackendSelectionCard,
  type BackendConfirmationCard,
  type BackendSelectionCard,
  type SessionControlCard,
} from './cards.js';
import { parseAskCommand } from './commands/ask.js';

export type FeishuRunGateResult =
  | {
    kind: 'blocked';
    reason: 'backend-selection';
    card: BackendSelectionCard;
  }
  | {
    kind: 'ready';
    backend: BackendName;
  };

export function beginFeishuConversationRun(
  options: {
    conversationId: string;
    prompt: string;
  },
): FeishuRunGateResult {
  const backend = conversationBackend.get(options.conversationId);
  if (!backend) {
    return {
      kind: 'blocked',
      reason: 'backend-selection',
      card: createBackendSelectionCard(options.conversationId, options.prompt),
    };
  }

  return {
    kind: 'ready',
    backend,
  };
}

export function requestBackendChange(
  conversationId: string,
  requestedBackend: BackendName,
): BackendConfirmationCard {
  const currentBackend = conversationBackend.get(conversationId) ?? 'claude';
  pendingBackendChanges.set(conversationId, requestedBackend);
  return createBackendConfirmationCard(conversationId, currentBackend, requestedBackend);
}

export function confirmBackendChange(
  conversationId: string,
  requestedBackend: BackendName,
): {
  backend: BackendName;
  continuationCleared: boolean;
} {
  const pending = pendingBackendChanges.get(conversationId);
  const nextBackend = pending ?? requestedBackend;
  pendingBackendChanges.delete(conversationId);

  const continuationCleared = conversationSessions.delete(conversationId);
  conversationBackend.set(conversationId, nextBackend);

  return {
    backend: nextBackend,
    continuationCleared,
  };
}

export type FeishuCardAction =
  | { conversationId: string; type: 'interrupt' }
  | { conversationId: string; type: 'done' }
  | { conversationId: string; type: 'backend'; value: BackendName }
  | { conversationId: string; type: 'model'; value: string }
  | { conversationId: string; type: 'effort'; value: string };

export function dispatchFeishuCardAction(action: FeishuCardAction): {
  kind: string;
  conversationId: string;
} | BackendConfirmationCard {
  if (action.type === 'interrupt') {
    return { kind: 'interrupt', conversationId: action.conversationId };
  }

  if (action.type === 'done') {
    conversationSessions.delete(action.conversationId);
    return { kind: 'done', conversationId: action.conversationId };
  }

  if (action.type === 'backend') {
    const currentBackend = conversationBackend.get(action.conversationId);
    if (currentBackend && currentBackend !== action.value) {
      return requestBackendChange(action.conversationId, action.value);
    }

    pendingBackendChanges.delete(action.conversationId);
    conversationBackend.set(action.conversationId, action.value);
    return { kind: 'backend', conversationId: action.conversationId };
  }

  if (action.type === 'model') {
    conversationModels.set(action.conversationId, action.value);
    return { kind: 'model', conversationId: action.conversationId };
  }

  conversationEffort.set(action.conversationId, action.value);
  return { kind: 'effort', conversationId: action.conversationId };
}

export function resolveFeishuMessageRequest(content: string): {
  mode: 'code' | 'ask';
  prompt: string;
} {
  const askPrompt = parseAskCommand(content);
  if (askPrompt) {
    return {
      mode: 'ask',
      prompt: askPrompt,
    };
  }

  return {
    mode: 'code',
    prompt: content.trim(),
  };
}

export function rememberFeishuConversationMode(
  conversationId: string,
  mode: 'code' | 'ask',
): void {
  conversationMode.set(conversationId, mode);
}

export { buildSessionControlCard };
