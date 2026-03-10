import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyMessageControlDirectives,
  conversationBackend,
  conversationSessions,
  confirmThreadSessionBinding,
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

  it('preserves ordinary prompt formatting when no control tag is present', () => {
    const prompt = [
      '```yaml',
      '  service:',
      '    image: app',
      '```',
      '',
    ].join('\n');

    expect(preprocessConversationMessage(prompt)).toEqual({
      prompt,
      directives: [],
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

  it('preserves leading indentation on the remaining first line after removing a backend tag', () => {
    expect(preprocessConversationMessage('<set-backend>codex</set-backend>  const x = 1;')).toEqual({
      prompt: '  const x = 1;',
      directives: [
        { type: 'backend', value: 'codex' },
      ],
    });
  });

  it('preserves newlines when removing inline backend tags before an indented line', () => {
    expect(preprocessConversationMessage('prefix <set-backend>codex</set-backend>\n  first line')).toEqual({
      prompt: 'prefix\n  first line',
      directives: [
        { type: 'backend', value: 'codex' },
      ],
    });
  });

  it('removes the control tag without collapsing indentation in multiline prompts', () => {
    expect(preprocessConversationMessage([
      '<set-backend>codex</set-backend>',
      '```yaml',
      '  service:',
      '    image: app',
      '```',
    ].join('\n'))).toEqual({
      prompt: [
        '```yaml',
        '  service:',
        '    image: app',
        '```',
      ].join('\n'),
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

  it('treats malformed nested backend tags as plain text', () => {
    const prompt = '<set-backend><set-backend>codex</set-backend></set-backend>';

    expect(preprocessConversationMessage(prompt)).toEqual({
      prompt,
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

  it('keeps only the last valid backend directive before applying controller changes', () => {
    conversationBackend.set('conv-last-wins', 'claude');
    conversationSessions.set('conv-last-wins', 'session-2');
    openThreadSessionBinding({
      conversationId: 'conv-last-wins',
      backend: 'claude',
      now: '2026-03-10T00:00:00.000Z',
    });
    confirmThreadSessionBinding({
      conversationId: 'conv-last-wins',
      nativeSessionId: 'session-2',
      now: '2026-03-10T00:00:30.000Z',
    });
    updateThreadContinuationSnapshot({
      conversationId: 'conv-last-wins',
      taskSummary: 'Do not clear this continuation.',
      whyStopped: 'completed',
      updatedAt: '2026-03-10T00:01:00.000Z',
    });

    const preprocessed = preprocessConversationMessage(
      '<set-backend>codex</set-backend><set-backend>claude</set-backend>',
    );

    expect(preprocessed).toEqual({
      prompt: '',
      directives: [
        { type: 'backend', value: 'claude' },
      ],
    });

    expect(applyMessageControlDirectives({
      conversationId: 'conv-last-wins',
      directives: preprocessed.directives,
    })).toEqual([
      {
        kind: 'backend',
        conversationId: 'conv-last-wins',
        stateChanged: false,
        persist: false,
        clearContinuation: false,
        requiresConfirmation: false,
        summaryKey: 'backend.updated',
        backend: 'claude',
      },
    ]);

    expect(conversationSessions.get('conv-last-wins')).toBe('session-2');
    expect(threadSessionBindings.has('conv-last-wins')).toBe(true);
    expect(threadContinuationSnapshots.has('conv-last-wins')).toBe(true);
  });
});
