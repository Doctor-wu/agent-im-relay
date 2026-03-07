import { beforeEach, describe, expect, it } from 'vitest';

import {
  conversationBackend,
  conversationSessions,
} from '@agent-im-relay/core';
import {
  beginFeishuConversationRun,
  confirmBackendChange,
  requestBackendChange,
} from '../runtime.js';

describe('Feishu backend gate', () => {
  beforeEach(() => {
    conversationBackend.clear();
    conversationSessions.clear();
  });

  it('blocks a new conversation until backend selection completes', () => {
    const result = beginFeishuConversationRun({
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
    }));
    expect(conversationBackend.has('conv-new')).toBe(false);
  });

  it('reuses the saved backend for an existing conversation without re-prompting', () => {
    conversationBackend.set('conv-existing', 'codex');

    const result = beginFeishuConversationRun({
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

    const pending = requestBackendChange('conv-switch', 'codex');
    expect(pending).toEqual(expect.objectContaining({
      type: 'backend-confirmation',
      conversationId: 'conv-switch',
      currentBackend: 'claude',
      requestedBackend: 'codex',
    }));
    expect(conversationBackend.get('conv-switch')).toBe('claude');
    expect(conversationSessions.get('conv-switch')).toBe('session-1');

    const confirmed = confirmBackendChange('conv-switch', 'codex');
    expect(confirmed).toEqual({
      backend: 'codex',
      continuationCleared: true,
    });
    expect(conversationBackend.get('conv-switch')).toBe('codex');
    expect(conversationSessions.has('conv-switch')).toBe(false);
  });
});
