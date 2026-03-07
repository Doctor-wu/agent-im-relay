import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildAgentPrompt,
  conversationBackend,
  conversationEffort,
  conversationModels,
  conversationSessions,
  pendingBackendChanges,
} from '@agent-im-relay/core';
import {
  buildSessionControlCard,
  dispatchFeishuCardAction,
  resolveFeishuMessageRequest,
} from '../index.js';

describe('Feishu actions', () => {
  beforeEach(() => {
    conversationBackend.clear();
    conversationEffort.clear();
    conversationModels.clear();
    conversationSessions.clear();
    pendingBackendChanges.clear();
  });

  it('maps card actions to interrupt, done, backend, model, and effort controls', () => {
    const card = buildSessionControlCard('conv-actions');
    expect(card.actions.map(action => action.type)).toEqual([
      'interrupt',
      'done',
      'backend',
      'model',
      'effort',
    ]);

    conversationSessions.set('conv-actions', 'session-1');
    expect(dispatchFeishuCardAction({ conversationId: 'conv-actions', type: 'interrupt' })).toEqual({
      kind: 'interrupt',
      conversationId: 'conv-actions',
      interrupted: false,
      stateChanged: false,
      persist: false,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'interrupt.noop',
    });

    expect(dispatchFeishuCardAction({ conversationId: 'conv-actions', type: 'done' })).toEqual({
      kind: 'done',
      conversationId: 'conv-actions',
      stateChanged: true,
      persist: true,
      clearContinuation: true,
      requiresConfirmation: false,
      summaryKey: 'done.ok',
    });
    expect(conversationSessions.has('conv-actions')).toBe(false);

    expect(dispatchFeishuCardAction({ conversationId: 'conv-actions', type: 'backend', value: 'codex' })).toEqual({
      kind: 'backend',
      conversationId: 'conv-actions',
      stateChanged: true,
      persist: true,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'backend.updated',
      backend: 'codex',
    });
    expect(dispatchFeishuCardAction({ conversationId: 'conv-actions', type: 'model', value: 'claude-3-7' })).toEqual({
      kind: 'model',
      conversationId: 'conv-actions',
      value: 'claude-3-7',
      stateChanged: true,
      persist: true,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'model.updated',
    });
    expect(dispatchFeishuCardAction({ conversationId: 'conv-actions', type: 'effort', value: 'high' })).toEqual({
      kind: 'effort',
      conversationId: 'conv-actions',
      value: 'high',
      stateChanged: true,
      persist: true,
      clearContinuation: false,
      requiresConfirmation: false,
      summaryKey: 'effort.updated',
    });

    expect(conversationBackend.get('conv-actions')).toBe('codex');
    expect(conversationModels.get('conv-actions')).toBe('claude-3-7');
    expect(conversationEffort.get('conv-actions')).toBe('high');
  });

  it('defaults ordinary messages to code mode', () => {
    expect(resolveFeishuMessageRequest('Build a relay card')).toEqual({
      mode: 'code',
      prompt: 'Build a relay card',
    });
  });

  it('keeps the explicit ask path out of code-mode artifact return instructions', () => {
    const askRequest = resolveFeishuMessageRequest('/ask What changed?');
    const codeRequest = resolveFeishuMessageRequest('Implement it');

    expect(askRequest).toEqual({
      mode: 'ask',
      prompt: 'What changed?',
    });
    expect(buildAgentPrompt(askRequest)).not.toContain('```artifacts');
    expect(buildAgentPrompt(codeRequest)).toContain('```artifacts');
  });
});
