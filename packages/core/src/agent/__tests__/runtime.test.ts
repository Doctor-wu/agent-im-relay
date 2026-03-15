import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBackend, type AgentBackend } from '../backend';
import {
  getPendingPermissionRequests,
  interruptConversationRun,
  isConversationRunning,
  registerConversationPermissionResponder,
  registerPermissionRequest,
  resolvePermissionRequest,
  resetConversationRuntimeForTests,
  runConversationSession,
} from '../runtime';
import {
  interruptConversationRun as interruptConversationRunFromRoot,
  isConversationRunning as isConversationRunningFromRoot,
  runConversationSession as runConversationSessionFromRoot,
} from '../../index';

function createBackend(events: Array<unknown>): AgentBackend {
  return {
    name: 'claude',
    isAvailable: () => true,
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

describe('conversation runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetConversationRuntimeForTests();
  });

  it('tracks active runs and clears them after completion', async () => {
    const events = runConversationSession('conv-1', {
      mode: 'ask',
      prompt: 'hi',
      backend: createBackend([{ type: 'done', result: 'ok' }]),
    });

    expect(isConversationRunning('conv-1')).toBe(true);

    const received = [];
    for await (const event of events) {
      received.push(event);
    }

    expect(received).toEqual([{ type: 'done', result: 'ok' }]);
    expect(isConversationRunning('conv-1')).toBe(false);
  });

  it('aborts an active run', async () => {
    const events = runConversationSession('conv-2', {
      mode: 'ask',
      prompt: 'stop me',
      backend: createBackend([
        { type: 'status', status: 'working' },
        { type: 'done', result: 'should not finish' },
      ]),
    });

    expect(interruptConversationRun('conv-2')).toBe(true);

    const received = [];
    for await (const event of events) {
      received.push(event);
    }

    expect(received).toContainEqual({ type: 'error', error: 'Agent request aborted' });
    expect(isConversationRunning('conv-2')).toBe(false);
  });

  it('returns false when interrupting an idle conversation', () => {
    expect(interruptConversationRun('idle')).toBe(false);
  });

  it('tracks and resolves pending permission requests', async () => {
    const decisions: Array<{ requestId: string | number; decision: 'approved' | 'denied' }> = [];

    registerConversationPermissionResponder('conv-perm', {
      backend: 'claude',
      respond(requestId, decision) {
        decisions.push({ requestId, decision });
      },
    });

    const request = registerPermissionRequest({
      conversationId: 'conv-perm',
      requestId: 'perm-1',
      backend: 'claude',
      tool: 'Bash',
      reason: 'Run pwd',
      timeoutMs: 120000,
    });

    expect(getPendingPermissionRequests('conv-perm')).toEqual([request]);

    const resolved = resolvePermissionRequest({
      conversationId: 'conv-perm',
      requestId: 'perm-1',
      decision: 'approved',
    });

    expect(resolved).toMatchObject({
      requestId: 'perm-1',
      backend: 'claude',
      decision: 'approved',
    });
    expect(decisions).toEqual([{ requestId: 'perm-1', decision: 'approved' }]);
    expect(getPendingPermissionRequests('conv-perm')).toEqual([]);
  });

  it('auto-denies timed out permission requests and rejects duplicate resolution', () => {
    const decisions: Array<{ requestId: string | number; decision: 'approved' | 'denied' }> = [];

    registerConversationPermissionResponder('conv-timeout', {
      backend: 'codex',
      respond(requestId, decision) {
        decisions.push({ requestId, decision });
      },
    });

    registerPermissionRequest({
      conversationId: 'conv-timeout',
      requestId: 'perm-timeout',
      backend: 'codex',
      reason: 'Request network access',
      timeoutMs: 1000,
    });

    vi.advanceTimersByTime(1000);

    expect(decisions).toEqual([{ requestId: 'perm-timeout', decision: 'denied' }]);
    expect(getPendingPermissionRequests('conv-timeout')).toEqual([]);
    expect(() => resolvePermissionRequest({
      conversationId: 'conv-timeout',
      requestId: 'perm-timeout',
      decision: 'approved',
    })).toThrow(/not pending/i);
  });

  it('preserves numeric requestId type through the resolve roundtrip', async () => {
    const decisions: Array<{ requestId: string | number; decision: 'approved' | 'denied' }> = [];

    registerConversationPermissionResponder('conv-num', {
      backend: 'codex',
      respond(requestId, decision) {
        decisions.push({ requestId, decision });
      },
    });

    registerPermissionRequest({
      conversationId: 'conv-num',
      requestId: 0,
      backend: 'codex',
      tool: 'Bash',
      reason: 'Run ls',
      timeoutMs: 120000,
    });

    const resolved = resolvePermissionRequest({
      conversationId: 'conv-num',
      requestId: '0',
      decision: 'approved',
    });

    expect(resolved).toMatchObject({
      requestId: 0,
      backend: 'codex',
      decision: 'approved',
    });
    expect(decisions).toEqual([{ requestId: 0, decision: 'approved' }]);
  });

  it('appends the artifacts block contract for code-mode runs', async () => {
    let receivedPrompt = '';

    const events = runConversationSession('conv-code', {
      mode: 'code',
      prompt: 'Build a report exporter',
      backend: {
        name: 'claude',
        isAvailable: () => true,
        async *stream(options) {
          receivedPrompt = options.prompt;
          yield { type: 'done', result: 'ok' } as const;
        },
      },
    });

    for await (const _event of events) {
      // exhaust stream
    }

    expect(receivedPrompt).toContain('Build a report exporter');
    expect(receivedPrompt).toContain('```artifacts');
    expect(receivedPrompt).toContain('"files"');
  });

  it('keeps ask-mode prompts free of artifact upload instructions', async () => {
    let receivedPrompt = '';

    const events = runConversationSession('conv-ask-prompt', {
      mode: 'ask',
      prompt: 'Explain the attached document',
      backend: {
        name: 'claude',
        isAvailable: () => true,
        async *stream(options) {
          receivedPrompt = options.prompt;
          yield { type: 'done', result: 'ok' } as const;
        },
      },
    });

    for await (const _event of events) {
      // exhaust stream
    }

    expect(receivedPrompt).toBe('Explain the attached document');
    expect(receivedPrompt).not.toContain('```artifacts');
  });

  it('surfaces unavailable registered backends as error events', async () => {
    registerBackend({
      name: 'offline-test-backend',
      isAvailable: () => false,
      async *stream() {
        yield { type: 'done', result: 'should not run' } as const;
      },
    });

    const events = runConversationSession('conv-offline', {
      mode: 'ask',
      prompt: 'hi',
      backend: 'offline-test-backend',
    });

    const received = [];
    for await (const event of events) {
      received.push(event);
    }

    expect(received).toEqual([
      { type: 'error', error: 'Backend not available: offline-test-backend' },
    ]);
    expect(isConversationRunning('conv-offline')).toBe(false);
  });

  it('clears pending permission requests when a run completes', async () => {
    const events = runConversationSession('conv-clear', {
      mode: 'ask',
      prompt: 'hi',
      backend: {
        name: 'claude',
        isAvailable: () => true,
        async *stream() {
          registerConversationPermissionResponder('conv-clear', {
            backend: 'claude',
            respond: () => undefined,
          });
          registerPermissionRequest({
            conversationId: 'conv-clear',
            requestId: 'perm-clear',
            backend: 'claude',
            timeoutMs: 120000,
          });
          yield { type: 'done', result: 'ok' } as const;
        },
      },
    });

    for await (const _event of events) {
      // exhaust
    }

    expect(getPendingPermissionRequests('conv-clear')).toEqual([]);
  });
});

describe('core exports', () => {
  it('re-exports runtime helpers', () => {
    expect(typeof runConversationSessionFromRoot).toBe('function');
    expect(typeof interruptConversationRunFromRoot).toBe('function');
    expect(typeof isConversationRunningFromRoot).toBe('function');
  });
});
