import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildAgentPrompt,
  conversationBackend,
  conversationEffort,
  conversationSessions,
  openThreadSessionBinding,
  pendingBackendChanges,
  threadContinuationSnapshots,
  threadSessionBindings,
  updateThreadContinuationSnapshot,
} from '@agent-im-relay/core';
import {
  buildFeishuCardContext,
  buildFeishuSessionAnchorCardPayload,
  buildFeishuSessionControlCardPayload,
  buildFeishuSessionChatRecord,
  buildSessionAnchorCard,
  buildSessionControlCard,
  dispatchFeishuCardAction,
  getFeishuSessionChat,
  rememberFeishuSessionChat,
  resolveFeishuMessageRequest,
  resetFeishuSessionChatsForTests,
} from '../index.js';

describe('Feishu actions', () => {
  beforeEach(() => {
    conversationBackend.clear();
    conversationEffort.clear();
    conversationSessions.clear();
    pendingBackendChanges.clear();
    threadSessionBindings.clear();
    threadContinuationSnapshots.clear();
    resetFeishuSessionChatsForTests();
  });

  it('maps card actions to interrupt, done, backend, and effort controls', () => {
    const card = buildSessionControlCard('conv-actions');
    expect(card.actions.map(action => action.type)).toEqual([
      'done',
      'backend',
      'effort',
    ]);

    conversationSessions.set('conv-actions', 'session-1');
    openThreadSessionBinding({
      conversationId: 'conv-actions',
      backend: 'claude',
      now: '2026-03-07T00:00:00.000Z',
    });
    updateThreadContinuationSnapshot({
      conversationId: 'conv-actions',
      taskSummary: 'Keep this Feishu conversation sticky.',
      whyStopped: 'completed',
      updatedAt: '2026-03-07T00:01:00.000Z',
    });

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
    expect(threadSessionBindings.has('conv-actions')).toBe(true);
    expect(threadContinuationSnapshots.has('conv-actions')).toBe(true);

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
    expect(threadSessionBindings.has('conv-actions')).toBe(false);
    expect(threadContinuationSnapshots.has('conv-actions')).toBe(false);

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

  it('keeps card action metadata and done state scoped to the session group chat', () => {
    const record = buildFeishuSessionChatRecord({
      sourceP2pChatId: 'p2p-chat-1',
      sourceMessageId: 'message-1',
      sessionChatId: 'session-chat-1',
      creatorOpenId: 'ou_user_1',
      createdAt: '2026-03-08T10:00:00.000Z',
      prompt: 'Review deployment plan',
    });
    rememberFeishuSessionChat(record);

    conversationSessions.set('session-chat-1', 'session-1');
    openThreadSessionBinding({
      conversationId: 'session-chat-1',
      backend: 'claude',
      now: '2026-03-08T10:00:00.000Z',
    });
    updateThreadContinuationSnapshot({
      conversationId: 'session-chat-1',
      taskSummary: 'Continue inside the session chat.',
      whyStopped: 'completed',
      updatedAt: '2026-03-08T10:01:00.000Z',
    });

    const anchorPayload = buildFeishuSessionAnchorCardPayload(
      buildSessionAnchorCard('session-chat-1'),
      buildFeishuCardContext('session-chat-1', {
        chatId: 'session-chat-1',
      }),
    );
    const anchorActionValues = anchorPayload.body.elements
      .filter((element: Record<string, unknown>) => element.tag === 'button')
      .map((button: Record<string, any>) => button.value);
    const panelPayload = buildFeishuSessionControlCardPayload(
      buildSessionControlCard('session-chat-1'),
      buildFeishuCardContext('session-chat-1', {
        chatId: 'session-chat-1',
      }),
    );
    const panelActionValues = panelPayload.body.elements
      .filter((element: Record<string, unknown>) => element.tag === 'button')
      .map((button: Record<string, any>) => button.value);

    expect(anchorActionValues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        conversationId: 'session-chat-1',
        chatId: 'session-chat-1',
        action: 'control-panel',
      }),
      expect.objectContaining({
        conversationId: 'session-chat-1',
        chatId: 'session-chat-1',
        action: 'interrupt',
      }),
    ]));
    expect(panelActionValues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        conversationId: 'session-chat-1',
        chatId: 'session-chat-1',
      }),
    ]));

    expect(dispatchFeishuCardAction({ conversationId: 'session-chat-1', type: 'done' })).toEqual(expect.objectContaining({
      kind: 'done',
      conversationId: 'session-chat-1',
      summaryKey: 'done.ok',
    }));
    expect(getFeishuSessionChat('session-chat-1')).toEqual(record);
  });
});
