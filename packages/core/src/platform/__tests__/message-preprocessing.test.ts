import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyMessageControlDirectives,
  conversationBackend,
  conversationSessions,
  pendingBackendChanges,
  preprocessConversationMessage,
  threadContinuationSnapshots,
  threadSessionBindings,
} from '../../index.js';
import { openThreadSessionBinding, updateThreadContinuationSnapshot } from '../../thread-session/manager.js';

describe('message preprocessing', () => {
  beforeEach(() => {
    conversationBackend.clear();
    conversationSessions.clear();
    pendingBackendChanges.clear();
    threadSessionBindings.clear();
    threadContinuationSnapshots.clear();
  });

  it('extracts a standalone backend tag into a control directive', () => {
    expect(preprocessConversationMessage('<set-backend>codex</set-backend>')).toEqual({
      prompt: '',
      directives: [
        { type: 'backend', value: 'codex' },
      ],
    });
  });

  it('extracts a backend tag and preserves the remaining prompt', () => {
    expect(preprocessConversationMessage('<set-backend>codex</set-backend>\nFix the failing test')).toEqual({
      prompt: 'Fix the failing test',
      directives: [
        { type: 'backend', value: 'codex' },
      ],
    });
  });

  it('leaves unsupported backend tags in the prompt as plain text', () => {
    expect(preprocessConversationMessage('<set-backend>gpt-5</set-backend>\nFix the failing test')).toEqual({
      prompt: '<set-backend>gpt-5</set-backend>\nFix the failing test',
      directives: [],
    });
  });

  it('auto-confirms backend switches when applying message control directives', () => {
    conversationBackend.set('conv-control', 'claude');
    conversationSessions.set('conv-control', 'session-1');
    openThreadSessionBinding({
      conversationId: 'conv-control',
      backend: 'claude',
      now: '2026-03-10T00:00:00.000Z',
    });
    updateThreadContinuationSnapshot({
      conversationId: 'conv-control',
      taskSummary: 'Keep the sticky continuation.',
      whyStopped: 'completed',
      updatedAt: '2026-03-10T00:01:00.000Z',
    });

    expect(applyMessageControlDirectives({
      conversationId: 'conv-control',
      directives: [
        { type: 'backend', value: 'codex' },
      ],
    })).toEqual([
      {
        kind: 'backend',
        conversationId: 'conv-control',
        stateChanged: true,
        persist: false,
        clearContinuation: false,
        requiresConfirmation: true,
        summaryKey: 'backend.confirm',
        currentBackend: 'claude',
        requestedBackend: 'codex',
      },
      {
        kind: 'confirm-backend',
        conversationId: 'conv-control',
        backend: 'codex',
        stateChanged: true,
        persist: true,
        clearContinuation: true,
        requiresConfirmation: false,
        summaryKey: 'backend.updated',
      },
    ]);

    expect(conversationBackend.get('conv-control')).toBe('codex');
    expect(conversationSessions.has('conv-control')).toBe(false);
    expect(threadSessionBindings.has('conv-control')).toBe(false);
    expect(threadContinuationSnapshots.has('conv-control')).toBe(false);
    expect(pendingBackendChanges.has('conv-control')).toBe(false);
  });
});
