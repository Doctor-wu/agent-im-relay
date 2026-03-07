import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runConversationSession } = vi.hoisted(() => ({
  runConversationSession: vi.fn(),
}));

vi.mock('../../agent/runtime.js', async () => {
  const actual = await vi.importActual<typeof import('../../agent/runtime.js')>('../../agent/runtime.js');
  return {
    ...actual,
    runConversationSession,
  };
});

import {
  activeConversations,
  conversationBackend,
  conversationCwd,
  conversationEffort,
  conversationModels,
  conversationSessions,
} from '../../index.js';
import { runConversationWithRenderer } from '../conversation-runner.js';

async function drainEvents(events: AsyncIterable<unknown>): Promise<void> {
  for await (const _event of events) {
    // Drain the stream to trigger runner side effects.
  }
}

describe('runConversationWithRenderer', () => {
  beforeEach(() => {
    activeConversations.clear();
    conversationBackend.clear();
    conversationCwd.clear();
    conversationEffort.clear();
    conversationModels.clear();
    conversationSessions.clear();
    runConversationSession.mockReset();
    runConversationSession.mockImplementation(async function* () {
      yield {
        type: 'environment',
        environment: {
          backend: 'claude',
          mode: 'code',
          model: {},
          cwd: { value: '/tmp/auto', source: 'auto-detected' },
          git: { isRepo: false },
        },
      };
      yield { type: 'status', status: 'cwd:/tmp/auto' };
      yield { type: 'done', result: 'done', sessionId: 'resolved-session' };
    });
  });

  it('runs one conversation without platform-specific thread assumptions', async () => {
    const render = vi.fn(async (_options, events) => {
      await drainEvents(events);
    });
    const publishArtifacts = vi.fn(async () => {});

    const started = await runConversationWithRenderer({
      conversationId: 'conv-1',
      target: { id: 'channel-1' },
      prompt: 'hello',
      defaultCwd: '/tmp/workspace',
      render,
      publishArtifacts,
    });

    expect(started).toBe(true);
    expect(render).toHaveBeenCalledWith(
      { target: { id: 'channel-1' }, showEnvironment: true },
      expect.any(Object),
    );
    expect(runConversationSession).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      mode: 'code',
      prompt: expect.stringContaining('hello'),
      cwd: '/tmp/workspace',
      sessionId: expect.any(String),
    }));
    expect(publishArtifacts).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      cwd: '/tmp/workspace',
      resultText: 'done',
      sourceMessageId: undefined,
      target: { id: 'channel-1' },
    });
  });

  it('preserves session state, cwd updates, and showEnvironment behavior across resumes', async () => {
    conversationSessions.set('conv-2', 'existing-session');
    conversationModels.set('conv-2', 'claude-3-7');
    conversationEffort.set('conv-2', 'high');
    conversationBackend.set('conv-2', 'codex');

    const render = vi.fn(async (_options, events) => {
      await drainEvents(events);
    });

    await runConversationWithRenderer({
      conversationId: 'conv-2',
      target: { id: 'channel-2' },
      prompt: 'resume',
      defaultCwd: '/tmp/workspace',
      render,
    });

    expect(render).toHaveBeenCalledWith(
      { target: { id: 'channel-2' }, showEnvironment: false },
      expect.any(Object),
    );
    expect(runConversationSession).toHaveBeenCalledWith('conv-2', expect.objectContaining({
      model: 'claude-3-7',
      effort: 'high',
      backend: 'codex',
      resumeSessionId: 'existing-session',
    }));
    expect(conversationSessions.get('conv-2')).toBe('resolved-session');
    expect(conversationCwd.get('conv-2')).toBe('/tmp/auto');
  });

  it('guards against concurrent runs on the same conversation', async () => {
    activeConversations.add('conv-busy');
    const render = vi.fn(async (_options, events) => {
      await drainEvents(events);
    });

    const started = await runConversationWithRenderer({
      conversationId: 'conv-busy',
      target: { id: 'channel-busy' },
      prompt: 'blocked',
      defaultCwd: '/tmp/workspace',
      render,
    });

    expect(started).toBe(false);
    expect(runConversationSession).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
});
