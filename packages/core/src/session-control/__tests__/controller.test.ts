import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentBackend } from '../../agent/backend.js';
import {
  resetConversationRuntimeForTests,
  runConversationSession,
} from '../../agent/runtime.js';
import {
  conversationBackend,
  conversationEffort,
  conversationModels,
  conversationSessions,
  pendingBackendChanges,
} from '../../state.js';
import { applySessionControlCommand } from '../controller.js';

function createBackend(events: Array<unknown>): AgentBackend {
  return {
    name: 'claude',
    async *stream(options) {
      for (const event of events) {
        if (options.abortSignal?.aborted) {
          yield { type: 'error', error: 'Agent request aborted' } as const;
          return;
        }

        yield event as never;
      }
    },
  };
}

describe('session control controller', () => {
  beforeEach(() => {
    resetConversationRuntimeForTests();
    conversationBackend.clear();
    conversationEffort.clear();
    conversationModels.clear();
    conversationSessions.clear();
    pendingBackendChanges.clear();
  });

  it('returns a noop interrupt result for idle conversations', () => {
    expect(applySessionControlCommand({
      conversationId: 'idle-conversation',
      type: 'interrupt',
    })).toEqual({
      kind: 'interrupt',
      conversationId: 'idle-conversation',
      interrupted: false,
      stateChanged: false,
      persist: false,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'interrupt.noop',
    });
  });

  it('interrupts an active conversation run', () => {
    const events = runConversationSession('running-conversation', {
      mode: 'ask',
      prompt: 'stop',
      backend: createBackend([
        { type: 'status', status: 'working' },
        { type: 'done', result: 'should not finish' },
      ]),
    });

    const result = applySessionControlCommand({
      conversationId: 'running-conversation',
      type: 'interrupt',
    });

    expect(result).toEqual({
      kind: 'interrupt',
      conversationId: 'running-conversation',
      interrupted: true,
      stateChanged: false,
      persist: false,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'interrupt.ok',
    });

    void events;
  });

  it('clears continuation state for done', () => {
    conversationSessions.set('conv-done', 'session-1');

    expect(applySessionControlCommand({
      conversationId: 'conv-done',
      type: 'done',
    })).toEqual({
      kind: 'done',
      conversationId: 'conv-done',
      stateChanged: true,
      persist: true,
      clearContinuation: true,
      requiresConfirmation: false,
      summaryKey: 'done.ok',
    });
    expect(conversationSessions.has('conv-done')).toBe(false);
  });

  it('requests confirmation before switching away from an existing backend', () => {
    conversationBackend.set('conv-backend', 'claude');

    expect(applySessionControlCommand({
      conversationId: 'conv-backend',
      type: 'backend',
      value: 'codex',
    })).toEqual({
      kind: 'backend',
      conversationId: 'conv-backend',
      stateChanged: true,
      persist: false,
      clearContinuation: false,
      requiresConfirmation: true,
      summaryKey: 'backend.confirm',
      currentBackend: 'claude',
      requestedBackend: 'codex',
    });
    expect(pendingBackendChanges.get('conv-backend')).toBe('codex');
  });

  it('updates backend immediately when there is no confirmation step', () => {
    expect(applySessionControlCommand({
      conversationId: 'conv-new-backend',
      type: 'backend',
      value: 'codex',
    })).toEqual({
      kind: 'backend',
      conversationId: 'conv-new-backend',
      stateChanged: true,
      persist: true,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'backend.updated',
      backend: 'codex',
    });
    expect(conversationBackend.get('conv-new-backend')).toBe('codex');
  });

  it('confirms a pending backend switch and clears continuation state', () => {
    conversationBackend.set('conv-confirm', 'claude');
    conversationSessions.set('conv-confirm', 'session-2');
    pendingBackendChanges.set('conv-confirm', 'codex');

    expect(applySessionControlCommand({
      conversationId: 'conv-confirm',
      type: 'confirm-backend',
      value: 'codex',
    })).toEqual({
      kind: 'confirm-backend',
      conversationId: 'conv-confirm',
      stateChanged: true,
      persist: true,
      clearContinuation: true,
      requiresConfirmation: false,
      summaryKey: 'backend.updated',
      backend: 'codex',
    });
    expect(conversationBackend.get('conv-confirm')).toBe('codex');
    expect(conversationSessions.has('conv-confirm')).toBe(false);
    expect(pendingBackendChanges.has('conv-confirm')).toBe(false);
  });

  it('cancels a pending backend switch without persisting', () => {
    pendingBackendChanges.set('conv-cancel', 'codex');

    expect(applySessionControlCommand({
      conversationId: 'conv-cancel',
      type: 'cancel-backend',
    })).toEqual({
      kind: 'cancel-backend',
      conversationId: 'conv-cancel',
      stateChanged: true,
      persist: false,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'backend.cancelled',
    });
    expect(pendingBackendChanges.has('conv-cancel')).toBe(false);
  });

  it('updates model and effort with persistence effects', () => {
    expect(applySessionControlCommand({
      conversationId: 'conv-settings',
      type: 'model',
      value: 'claude-3-7',
    })).toEqual({
      kind: 'model',
      conversationId: 'conv-settings',
      stateChanged: true,
      persist: true,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'model.updated',
      value: 'claude-3-7',
    });
    expect(conversationModels.get('conv-settings')).toBe('claude-3-7');

    expect(applySessionControlCommand({
      conversationId: 'conv-settings',
      type: 'effort',
      value: 'high',
    })).toEqual({
      kind: 'effort',
      conversationId: 'conv-settings',
      stateChanged: true,
      persist: true,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'effort.updated',
      value: 'high',
    });
    expect(conversationEffort.get('conv-settings')).toBe('high');
  });
});
