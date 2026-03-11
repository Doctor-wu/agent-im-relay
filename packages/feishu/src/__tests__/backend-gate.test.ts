import { beforeEach, describe, expect, it, vi } from 'vitest';

const coreMocks = vi.hoisted(() => ({
  getAvailableBackendCapabilities: vi.fn(async () => [
    {
      name: 'claude',
      models: [
        { id: 'sonnet', label: 'Sonnet' },
      ],
    },
    {
      name: 'codex',
      models: [],
    },
    {
      name: 'opencode',
      models: [],
    },
  ]),
  getAvailableBackendNames: vi.fn(async () => ['claude', 'opencode']),
}));

vi.mock('@agent-im-relay/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agent-im-relay/core')>();
  return {
    ...actual,
    getAvailableBackendCapabilities: coreMocks.getAvailableBackendCapabilities,
    getAvailableBackendNames: coreMocks.getAvailableBackendNames,
  };
});

import {
  conversationBackend,
  conversationSessions,
  openThreadSessionBinding,
  pendingBackendChanges,
  threadContinuationSnapshots,
  threadSessionBindings,
  updateThreadContinuationSnapshot,
} from '@agent-im-relay/core';
import {
  beginFeishuConversationRun,
  confirmBackendChange,
  dispatchFeishuCardAction,
  requestBackendChange,
} from '../runtime.js';

describe('Feishu backend gate', () => {
  beforeEach(() => {
    coreMocks.getAvailableBackendCapabilities.mockResolvedValue([
      {
        name: 'claude',
        models: [
          { id: 'sonnet', label: 'Sonnet' },
        ],
      },
      {
        name: 'codex',
        models: [],
      },
      {
        name: 'opencode',
        models: [],
      },
    ]);
    coreMocks.getAvailableBackendNames.mockResolvedValue(['claude', 'opencode']);
    conversationBackend.clear();
    conversationSessions.clear();
    pendingBackendChanges.clear();
    threadSessionBindings.clear();
    threadContinuationSnapshots.clear();
  });

  it('blocks a new conversation until backend selection completes', async () => {
    const result = await beginFeishuConversationRun({
      conversationId: 'conv-new',
      prompt: 'Build it',
    });

    expect(result).toEqual(expect.objectContaining({
      kind: 'blocked',
      reason: 'backend-selection',
    }));
    expect(result.card).toEqual(expect.objectContaining({
      type: 'backend-selection',
      conversationId: 'conv-new',
      backends: ['claude', 'opencode'],
    }));
    expect(conversationBackend.has('conv-new')).toBe(false);
  });

  it('reuses the saved backend for an existing conversation without re-prompting', async () => {
    conversationBackend.set('conv-existing', 'codex');

    const result = await beginFeishuConversationRun({
      conversationId: 'conv-existing',
      prompt: 'Continue',
    });

    expect(result).toEqual({
      kind: 'ready',
      backend: 'codex',
    });
  });

  it('invalidates the current continuation only after user confirmation when switching backend', () => {
    conversationBackend.set('conv-switch', 'claude');
    conversationSessions.set('conv-switch', 'session-1');
    openThreadSessionBinding({
      conversationId: 'conv-switch',
      backend: 'claude',
      now: '2026-03-07T00:00:00.000Z',
    });
    updateThreadContinuationSnapshot({
      conversationId: 'conv-switch',
      taskSummary: 'Continue in the same Feishu thread.',
      whyStopped: 'timeout',
      updatedAt: '2026-03-07T00:01:00.000Z',
    });

    const pending = dispatchFeishuCardAction({
      conversationId: 'conv-switch',
      type: 'backend',
      value: 'codex',
    });
    expect(pending).toEqual({
      kind: 'backend',
      conversationId: 'conv-switch',
      stateChanged: true,
      persist: false,
      clearContinuation: false,
      requiresConfirmation: true,
      summaryKey: 'backend.confirm',
      currentBackend: 'claude',
      requestedBackend: 'codex',
    });

    const card = requestBackendChange('conv-switch', 'codex');
    expect(card).toEqual(expect.objectContaining({
      type: 'backend-confirmation',
      conversationId: 'conv-switch',
      currentBackend: 'claude',
      requestedBackend: 'codex',
    }));
    expect(pendingBackendChanges.get('conv-switch')).toBe('codex');
    expect(conversationBackend.get('conv-switch')).toBe('claude');
    expect(conversationSessions.has('conv-switch')).toBe(false);
    expect(threadSessionBindings.has('conv-switch')).toBe(true);
    expect(threadContinuationSnapshots.has('conv-switch')).toBe(true);

    const confirmed = confirmBackendChange('conv-switch', 'codex');
    expect(confirmed).toEqual({
      kind: 'confirm-backend',
      conversationId: 'conv-switch',
      backend: 'codex',
      stateChanged: true,
      persist: true,
      clearContinuation: true,
      requiresConfirmation: false,
      summaryKey: 'backend.updated',
    });
    expect(conversationBackend.get('conv-switch')).toBe('codex');
    expect(conversationSessions.has('conv-switch')).toBe(false);
    expect(threadSessionBindings.has('conv-switch')).toBe(false);
    expect(threadContinuationSnapshots.has('conv-switch')).toBe(false);
  });

  it('skips backend confirmation when the controller updates immediately', () => {
    const result = dispatchFeishuCardAction({
      conversationId: 'conv-direct',
      type: 'backend',
      value: 'codex',
    });

    expect(result).toEqual({
      kind: 'backend',
      conversationId: 'conv-direct',
      stateChanged: true,
      persist: true,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'backend.updated',
      backend: 'codex',
    });

    expect(requestBackendChange('conv-new', 'claude')).toBeNull();
  });
});
