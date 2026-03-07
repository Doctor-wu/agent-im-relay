import type { BackendName } from '@agent-im-relay/core';

export interface BackendSelectionCard {
  type: 'backend-selection';
  conversationId: string;
  prompt: string;
  backends: BackendName[];
}

export interface BackendConfirmationCard {
  type: 'backend-confirmation';
  conversationId: string;
  currentBackend: BackendName;
  requestedBackend: BackendName;
}

export interface SessionControlAction {
  type: 'interrupt' | 'done' | 'backend' | 'model' | 'effort';
}

export interface SessionControlCard {
  type: 'session-controls';
  conversationId: string;
  actions: SessionControlAction[];
}

export function createBackendSelectionCard(conversationId: string, prompt: string): BackendSelectionCard {
  return {
    type: 'backend-selection',
    conversationId,
    prompt,
    backends: ['claude', 'codex'],
  };
}

export function createBackendConfirmationCard(
  conversationId: string,
  currentBackend: BackendName,
  requestedBackend: BackendName,
): BackendConfirmationCard {
  return {
    type: 'backend-confirmation',
    conversationId,
    currentBackend,
    requestedBackend,
  };
}

export function buildSessionControlCard(conversationId: string): SessionControlCard {
  return {
    type: 'session-controls',
    conversationId,
    actions: [
      { type: 'interrupt' },
      { type: 'done' },
      { type: 'backend' },
      { type: 'model' },
      { type: 'effort' },
    ],
  };
}
