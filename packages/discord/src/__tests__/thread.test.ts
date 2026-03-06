import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activeConversations,
  conversationSessions,
  interruptConversationRun,
  isConversationRunning,
} from '@agent-im-relay/core';
import type { AgentBackend } from '@agent-im-relay/core';
import { runMentionConversation } from '../conversation.js';
import { sanitizeThreadName } from '../thread.js';

function createBackend(): AgentBackend {
  return {
    name: 'claude',
    async *stream(options) {
      yield { type: 'status', status: 'working' } as const;
      await new Promise(resolve => setTimeout(resolve, 0));
      if (options.abortSignal?.aborted) {
        yield { type: 'error', error: 'Agent request aborted' } as const;
        return;
      }
      yield { type: 'done', result: 'ok', sessionId: 'resolved-session' } as const;
    },
  };
}

afterEach(() => {
  activeConversations.clear();
  conversationSessions.clear();
  interruptConversationRun('thread-123');
});

describe('sanitizeThreadName', () => {
  it('normalizes whitespace and prefixes thread names', () => {
    const name = sanitizeThreadName('   Fix    flaky   tests   ');
    expect(name).toBe('code: Fix flaky tests');
  });

  it('falls back to a default title when prompt is empty', () => {
    expect(sanitizeThreadName('   ')).toBe('code: New coding task');
  });

  it('truncates long prompts to Discord limits', () => {
    const name = sanitizeThreadName('x'.repeat(500));
    expect(name.startsWith('code: ')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(100);
  });
});

describe('runMentionConversation', () => {
  it('uses shared runtime so interrupted threads can run again', async () => {
    const thread = {
      id: 'thread-123',
      send: vi.fn(),
    } as any;

    const firstEvents: Array<Record<string, unknown>> = [];
    const firstRun = runMentionConversation(thread, 'first prompt', undefined, {
      backend: createBackend(),
      createSessionId: () => 'session-1',
      persist: vi.fn().mockResolvedValue(undefined),
      offerSaveCwd: vi.fn().mockResolvedValue(undefined),
      setReaction: vi.fn().mockResolvedValue(undefined),
      streamToDiscord: async (_target, events) => {
        for await (const event of events) {
          firstEvents.push(event);
          if (event.type === 'status') {
            expect(isConversationRunning(thread.id)).toBe(true);
            expect(interruptConversationRun(thread.id)).toBe(true);
          }
        }
      },
    });

    await expect(firstRun).resolves.toBe(true);
    expect(firstEvents).toContainEqual({ type: 'error', error: 'Agent request aborted' });
    expect(activeConversations.has(thread.id)).toBe(false);
    expect(isConversationRunning(thread.id)).toBe(false);

    const secondEvents: Array<Record<string, unknown>> = [];
    await expect(runMentionConversation(thread, 'second prompt', undefined, {
      backend: createBackend(),
      createSessionId: () => 'session-2',
      persist: vi.fn().mockResolvedValue(undefined),
      offerSaveCwd: vi.fn().mockResolvedValue(undefined),
      setReaction: vi.fn().mockResolvedValue(undefined),
      streamToDiscord: async (_target, events) => {
        for await (const event of events) {
          secondEvents.push(event);
        }
      },
    })).resolves.toBe(true);

    expect(secondEvents).toContainEqual({ type: 'done', result: 'ok', sessionId: 'resolved-session' });
    expect(conversationSessions.get(thread.id)).toBe('resolved-session');
  });
});
