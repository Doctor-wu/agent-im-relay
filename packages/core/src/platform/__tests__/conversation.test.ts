import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type GatewayToClientCommand,
  type ManagedBridgeTarget,
  conversationBackend,
  conversationEffort,
  conversationModels,
  conversationSessions,
  pendingBackendChanges,
} from '../../index.js';
import {
  applyConversationControlAction,
  evaluateConversationRunRequest,
} from '../conversation.js';
import * as sessionControlController from '../../session-control/controller.js';

describe('platform conversation setup and controls', () => {
  beforeEach(() => {
    conversationBackend.clear();
    conversationEffort.clear();
    conversationModels.clear();
    conversationSessions.clear();
    pendingBackendChanges.clear();
  });

  it('gates execution when backend selection is required but not configured', () => {
    expect(evaluateConversationRunRequest({
      conversationId: 'conv-1',
      requireBackendSelection: true,
    })).toEqual({
      kind: 'setup-required',
      conversationId: 'conv-1',
      reason: 'backend-selection',
    });
  });

  it('allows execution when backend selection is optional', () => {
    expect(evaluateConversationRunRequest({
      conversationId: 'conv-2',
    })).toEqual({
      kind: 'ready',
      conversationId: 'conv-2',
      backend: undefined,
    });
  });

  it('returns the saved backend when configured', () => {
    conversationBackend.set('conv-3', 'codex');

    expect(evaluateConversationRunRequest({
      conversationId: 'conv-3',
      requireBackendSelection: true,
    })).toEqual({
      kind: 'ready',
      conversationId: 'conv-3',
      backend: 'codex',
    });
  });

  it('applies interrupt, done, backend confirmation, confirm, cancel, model, and effort actions', () => {
    conversationBackend.set('conv-actions', 'claude');
    conversationSessions.set('conv-actions', 'session-1');

    expect(applyConversationControlAction({
      conversationId: 'conv-actions',
      type: 'interrupt',
    })).toEqual({
      kind: 'interrupt',
      conversationId: 'conv-actions',
      interrupted: false,
    });

    expect(applyConversationControlAction({
      conversationId: 'conv-actions',
      type: 'backend',
      value: 'codex',
    })).toEqual({
      kind: 'backend-confirmation',
      conversationId: 'conv-actions',
      currentBackend: 'claude',
      requestedBackend: 'codex',
    });
    expect(pendingBackendChanges.get('conv-actions')).toBe('codex');

    expect(applyConversationControlAction({
      conversationId: 'conv-actions',
      type: 'cancel-backend',
    })).toEqual({
      kind: 'cancel-backend',
      conversationId: 'conv-actions',
    });
    expect(pendingBackendChanges.has('conv-actions')).toBe(false);

    applyConversationControlAction({
      conversationId: 'conv-actions',
      type: 'backend',
      value: 'codex',
    });
    expect(applyConversationControlAction({
      conversationId: 'conv-actions',
      type: 'confirm-backend',
      value: 'codex',
    })).toEqual({
      kind: 'confirm-backend',
      conversationId: 'conv-actions',
      backend: 'codex',
      continuationCleared: true,
    });
    expect(conversationBackend.get('conv-actions')).toBe('codex');
    expect(conversationSessions.has('conv-actions')).toBe(false);

    expect(applyConversationControlAction({
      conversationId: 'conv-actions',
      type: 'model',
      value: 'claude-3-7',
    })).toEqual({
      kind: 'model',
      conversationId: 'conv-actions',
    });
    expect(conversationModels.get('conv-actions')).toBe('claude-3-7');

    expect(applyConversationControlAction({
      conversationId: 'conv-actions',
      type: 'effort',
      value: 'high',
    })).toEqual({
      kind: 'effort',
      conversationId: 'conv-actions',
    });
    expect(conversationEffort.get('conv-actions')).toBe('high');

    conversationSessions.set('conv-actions', 'session-2');
    expect(applyConversationControlAction({
      conversationId: 'conv-actions',
      type: 'done',
    })).toEqual({
      kind: 'done',
      conversationId: 'conv-actions',
      continuationCleared: true,
    });
    expect(conversationSessions.has('conv-actions')).toBe(false);
  });

  it('delegates session control semantics to the session-control controller', () => {
    const controllerSpy = vi.spyOn(sessionControlController, 'applySessionControlCommand');

    const result = applyConversationControlAction({
      conversationId: 'conv-delegated',
      type: 'backend',
      value: 'codex',
    });

    expect(controllerSpy).toHaveBeenCalledWith({
      conversationId: 'conv-delegated',
      type: 'backend',
      value: 'codex',
    });
    expect(result).toEqual({
      kind: 'backend',
      conversationId: 'conv-delegated',
    });
  });

  it('exports the managed bridge protocol types from the package root', () => {
    const target: ManagedBridgeTarget = {
      chatId: 'chat-1',
      replyToMessageId: 'message-1',
    };
    const command: GatewayToClientCommand = {
      type: 'conversation.run',
      clientId: 'client-1',
      requestId: 'request-1',
      conversationId: 'conv-bridge',
      timestamp: '2026-03-07T00:00:00.000Z',
      payload: {
        target,
        prompt: 'hello',
        mode: 'code',
      },
    };

    expect(command.payload.target.replyToMessageId).toBe('message-1');
  });
});
