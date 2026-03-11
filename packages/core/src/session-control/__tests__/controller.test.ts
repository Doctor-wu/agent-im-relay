import { beforeEach, describe, expect, it } from 'vitest';
import {
  registerBackend,
  resetBackendRegistryForTests,
  type AgentBackend,
} from '../../agent/backend.js';
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
  threadContinuationSnapshots,
  threadSessionBindings,
} from '../../state.js';
import { openThreadSessionBinding, updateThreadContinuationSnapshot } from '../../thread-session/manager.js';
import { applySessionControlCommand } from '../controller.js';

function createBackend(events: Array<unknown>): AgentBackend {
  return {
    name: 'claude',
    isAvailable: () => true,
    listModels: () => [],
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

function registerTestBackend(
  name: string,
  models: string[],
): void {
  registerBackend({
    name,
    isAvailable: () => true,
    listModels: () => models.map(model => ({ id: model, label: model })),
    async *stream() {
      yield { type: 'done', result: `${name}:ok` } as const;
    },
  });
}

async function collect(events: AsyncIterable<unknown>): Promise<unknown[]> {
  const collected: unknown[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

describe('session control controller', () => {
  beforeEach(() => {
    resetConversationRuntimeForTests();
    conversationBackend.clear();
    conversationEffort.clear();
    conversationModels.clear();
    conversationSessions.clear();
    pendingBackendChanges.clear();
    threadSessionBindings.clear();
    threadContinuationSnapshots.clear();
    resetBackendRegistryForTests();
    registerTestBackend('claude', ['sonnet', 'opus']);
    registerTestBackend('codex', ['gpt-5.4']);
    registerTestBackend('opencode', []);
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

  it('interrupts an active run when done clears the thread continuation', async () => {
    openThreadSessionBinding({
      conversationId: 'conv-done-running',
      backend: 'claude',
      now: '2026-03-07T00:00:00.000Z',
    });
    updateThreadContinuationSnapshot({
      conversationId: 'conv-done-running',
      taskSummary: 'Keep this thread open.',
      whyStopped: 'completed',
      updatedAt: '2026-03-07T00:01:00.000Z',
    });

    const events = runConversationSession('conv-done-running', {
      mode: 'ask',
      prompt: 'stop',
      backend: createBackend([
        { type: 'status', status: 'working' },
        { type: 'done', result: 'should not finish' },
      ]),
    });

    const result = applySessionControlCommand({
      conversationId: 'conv-done-running',
      type: 'done',
    });

    expect(result).toEqual({
      kind: 'done',
      conversationId: 'conv-done-running',
      stateChanged: true,
      persist: true,
      clearContinuation: true,
      requiresConfirmation: false,
      summaryKey: 'done.ok',
    });
    await expect(collect(events)).resolves.toEqual([
      { type: 'error', error: 'Agent request aborted' },
    ]);
    expect(threadSessionBindings.has('conv-done-running')).toBe(false);
    expect(threadContinuationSnapshots.has('conv-done-running')).toBe(false);
    expect(conversationSessions.has('conv-done-running')).toBe(false);
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

  it('clears stale models when switching to a new backend instead of applying legacy suffix migration', () => {
    conversationBackend.set('conv-opencode-switch', 'codex');
    conversationModels.set('conv-opencode-switch', 'gpt-5');
    resetBackendRegistryForTests();
    registerTestBackend('codex', ['gpt-5']);
    registerTestBackend('opencode', ['openai/gpt-5']);

    expect(applySessionControlCommand({
      conversationId: 'conv-opencode-switch',
      type: 'backend',
      value: 'opencode',
    })).toEqual({
      kind: 'backend',
      conversationId: 'conv-opencode-switch',
      stateChanged: true,
      persist: false,
      clearContinuation: false,
      requiresConfirmation: true,
      summaryKey: 'backend.confirm',
      currentBackend: 'codex',
      requestedBackend: 'opencode',
    });

    expect(applySessionControlCommand({
      conversationId: 'conv-opencode-switch',
      type: 'confirm-backend',
      value: 'opencode',
    })).toEqual({
      kind: 'confirm-backend',
      conversationId: 'conv-opencode-switch',
      backend: 'opencode',
      stateChanged: true,
      persist: true,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'backend.updated',
    });
    expect(conversationModels.has('conv-opencode-switch')).toBe(false);
  });

  it('confirms a pending backend switch and clears continuation state', () => {
    conversationBackend.set('conv-confirm', 'claude');
    conversationSessions.set('conv-confirm', 'session-2');
    pendingBackendChanges.set('conv-confirm', 'codex');
    conversationModels.set('conv-confirm', 'sonnet');

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
    expect(conversationModels.has('conv-confirm')).toBe(false);
    expect(conversationSessions.has('conv-confirm')).toBe(false);
    expect(pendingBackendChanges.has('conv-confirm')).toBe(false);
  });

  it('clears the previous model when switching to a backend with no supported-model list', () => {
    conversationBackend.set('conv-empty-models', 'claude');
    conversationModels.set('conv-empty-models', 'sonnet');

    expect(applySessionControlCommand({
      conversationId: 'conv-empty-models',
      type: 'backend',
      value: 'opencode',
    })).toEqual({
      kind: 'backend',
      conversationId: 'conv-empty-models',
      stateChanged: true,
      persist: false,
      clearContinuation: false,
      requiresConfirmation: true,
      summaryKey: 'backend.confirm',
      currentBackend: 'claude',
      requestedBackend: 'opencode',
    });

    pendingBackendChanges.set('conv-empty-models', 'opencode');

    expect(applySessionControlCommand({
      conversationId: 'conv-empty-models',
      type: 'confirm-backend',
      value: 'opencode',
    })).toEqual({
      kind: 'confirm-backend',
      conversationId: 'conv-empty-models',
      backend: 'opencode',
      stateChanged: true,
      persist: true,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'backend.updated',
    });
    expect(conversationModels.has('conv-empty-models')).toBe(false);
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
