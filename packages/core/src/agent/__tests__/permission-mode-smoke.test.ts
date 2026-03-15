import { afterEach, describe, expect, it } from 'vitest';
import {
  registerConversationPermissionResponder,
  registerPermissionRequest,
  resetConversationRuntimeForTests,
  resolvePermissionRequest,
  runConversationSession,
} from '../runtime.js';
import type { AgentBackend } from '../backend.js';

describe('permission mode smoke', () => {
  afterEach(() => {
    resetConversationRuntimeForTests();
  });

  it('streams a permission request, resolves it once, and continues the backend run', async () => {
    const decisions: Array<'approved' | 'denied'> = [];
    const backend: AgentBackend = {
      name: 'claude',
      isAvailable: () => true,
      async *stream(options) {
        if (!options.conversationId) {
          throw new Error('conversationId is required');
        }

        registerConversationPermissionResponder(options.conversationId, {
          backend: 'claude',
          respond(_requestId, decision) {
            decisions.push(decision);
          },
        });

        const request = registerPermissionRequest({
          conversationId: options.conversationId,
          requestId: 'perm-smoke-1',
          backend: 'claude',
          tool: 'Bash',
          reason: 'Run smoke command',
          timeoutMs: 120000,
        });

        yield {
          type: 'permission-requested',
          requestId: request.requestId,
          backend: request.backend,
          tool: request.tool,
          reason: request.reason,
          expiresAt: request.expiresAt,
        } as const;

        while (decisions.length === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        yield { type: 'done', result: 'smoke complete' } as const;
      },
    };

    const iterator = runConversationSession('conv-smoke', {
      mode: 'code',
      prompt: 'run smoke test',
      backend,
    })[Symbol.asyncIterator]();

    const requested = await iterator.next();
    expect(requested.value).toMatchObject({
      type: 'permission-requested',
      requestId: 'perm-smoke-1',
      backend: 'claude',
    });

    resolvePermissionRequest({
      conversationId: 'conv-smoke',
      requestId: 'perm-smoke-1',
      decision: 'approved',
    });

    const resolved = await iterator.next();
    expect(resolved.value).toEqual({
      type: 'permission-resolved',
      requestId: 'perm-smoke-1',
      backend: 'claude',
      decision: 'approved',
    });

    const done = await iterator.next();
    expect(done.value).toEqual({
      type: 'done',
      result: 'smoke complete',
    });
    expect(decisions).toEqual(['approved']);
  });
});
