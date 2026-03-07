import { interruptConversationRun } from '../agent/runtime.js';
import { closeThreadSession } from '../thread-session/manager.js';
import {
  conversationBackend,
  conversationEffort,
  conversationModels,
  pendingBackendChanges,
} from '../state.js';
import type { SessionControlCommand, SessionControlResult } from './types.js';

function updateStringMap(
  store: Map<string, string>,
  conversationId: string,
  value: string,
): { stateChanged: boolean; persist: boolean } {
  const previousValue = store.get(conversationId);
  if (previousValue === value) {
    return { stateChanged: false, persist: false };
  }

  store.set(conversationId, value);
  return { stateChanged: true, persist: true };
}

export function applySessionControlCommand(command: SessionControlCommand): SessionControlResult {
  if (command.type === 'interrupt') {
    const interrupted = interruptConversationRun(command.conversationId);
    return {
      kind: 'interrupt',
      conversationId: command.conversationId,
      interrupted,
      stateChanged: false,
      persist: false,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: interrupted ? 'interrupt.ok' : 'interrupt.noop',
    };
  }

  if (command.type === 'done') {
    const cleared = closeThreadSession({ conversationId: command.conversationId });
    const clearContinuation = cleared.bindingCleared || cleared.snapshotCleared || cleared.sessionCleared;
    return {
      kind: 'done',
      conversationId: command.conversationId,
      stateChanged: clearContinuation,
      persist: clearContinuation,
      clearContinuation,
      requiresConfirmation: false,
      summaryKey: clearContinuation ? 'done.ok' : 'done.noop',
    };
  }

  if (command.type === 'backend') {
    const currentBackend = conversationBackend.get(command.conversationId);
    if (currentBackend && currentBackend !== command.value) {
      pendingBackendChanges.set(command.conversationId, command.value);
      return {
        kind: 'backend',
        conversationId: command.conversationId,
        stateChanged: true,
        persist: false,
        clearContinuation: false,
        requiresConfirmation: true,
        summaryKey: 'backend.confirm',
        currentBackend,
        requestedBackend: command.value,
      };
    }

    const hadPendingChange = pendingBackendChanges.delete(command.conversationId);
    const backendChanged = currentBackend !== command.value;
    conversationBackend.set(command.conversationId, command.value);

    return {
      kind: 'backend',
      conversationId: command.conversationId,
      stateChanged: backendChanged || hadPendingChange,
      persist: backendChanged,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'backend.updated',
      backend: command.value,
    };
  }

  if (command.type === 'confirm-backend') {
    const pendingBackend = pendingBackendChanges.get(command.conversationId);
    const backend = pendingBackend ?? command.value;
    const hadPendingChange = pendingBackendChanges.delete(command.conversationId);
    const backendChanged = conversationBackend.get(command.conversationId) !== backend;
    const cleared = closeThreadSession({ conversationId: command.conversationId });
    const clearContinuation = cleared.bindingCleared || cleared.snapshotCleared || cleared.sessionCleared;
    conversationBackend.set(command.conversationId, backend);

    return {
      kind: 'confirm-backend',
      conversationId: command.conversationId,
      backend,
      stateChanged: hadPendingChange || backendChanged || clearContinuation,
      persist: hadPendingChange || backendChanged || clearContinuation,
      clearContinuation,
      requiresConfirmation: false,
      summaryKey: 'backend.updated',
    };
  }

  if (command.type === 'cancel-backend') {
    const stateChanged = pendingBackendChanges.delete(command.conversationId);
    return {
      kind: 'cancel-backend',
      conversationId: command.conversationId,
      stateChanged,
      persist: false,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: stateChanged ? 'backend.cancelled' : 'backend.cancelled-noop',
    };
  }

  if (command.type === 'model') {
    const { stateChanged, persist } = updateStringMap(
      conversationModels,
      command.conversationId,
      command.value,
    );
    return {
      kind: 'model',
      conversationId: command.conversationId,
      value: command.value,
      stateChanged,
      persist,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: stateChanged ? 'model.updated' : 'model.noop',
    };
  }

  const { stateChanged, persist } = updateStringMap(
    conversationEffort,
    command.conversationId,
    command.value,
  );
  return {
    kind: 'effort',
    conversationId: command.conversationId,
    value: command.value,
    stateChanged,
    persist,
    clearContinuation: false,
    requiresConfirmation: false,
    summaryKey: stateChanged ? 'effort.updated' : 'effort.noop',
  };
}
