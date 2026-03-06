import { afterEach, describe, expect, it } from 'vitest';
import type { AgentBackend } from '../backend.js';
import {
  interruptConversationRun,
  isConversationRunning,
  resetConversationRuntimeForTests,
  runConversationSession,
} from '../runtime.js';
import {
  interruptConversationRun as interruptConversationRunFromRoot,
  isConversationRunning as isConversationRunningFromRoot,
  runConversationSession as runConversationSessionFromRoot,
} from '../../index.js';

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

describe('conversation runtime', () => {
  afterEach(() => {
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
});

describe('core exports', () => {
  it('re-exports runtime helpers', () => {
    expect(typeof runConversationSessionFromRoot).toBe('function');
    expect(typeof interruptConversationRunFromRoot).toBe('function');
    expect(typeof isConversationRunningFromRoot).toBe('function');
  });
});
