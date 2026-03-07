import { randomUUID } from 'node:crypto';
import { runConversationSession } from '../agent/runtime.js';
import {
  activeConversations,
  conversationBackend,
  conversationCwd,
  conversationEffort,
  conversationModels,
  conversationSessions,
  persistState,
} from '../state.js';
import type { AgentMode } from '../agent/tools.js';
import type { AgentBackend, BackendName } from '../agent/backend.js';
import type { AgentStreamEvent } from '../agent/session.js';

export type ConversationRunPhase = 'thinking' | 'tools' | 'done' | 'error';

type PreparedPrompt = {
  prompt: string;
};

type ConversationRunOptions<TTarget, TTrigger = unknown> = {
  conversationId: string;
  target: TTarget;
  prompt: string;
  mode?: AgentMode;
  trigger?: TTrigger;
  sourceMessageId?: string;
  backend?: BackendName | AgentBackend;
  defaultCwd: string;
  createSessionId?: () => string;
  persist?: () => Promise<void>;
  preparePrompt?: (options: {
    conversationId: string;
    prompt: string;
    sourceMessageId?: string;
  }) => Promise<PreparedPrompt>;
  render: (
    options: { target: TTarget; showEnvironment: boolean; initialMessage?: TTrigger },
    events: AsyncIterable<AgentStreamEvent>,
  ) => Promise<void>;
  publishArtifacts?: (options: {
    conversationId: string;
    cwd: string;
    resultText: string;
    sourceMessageId?: string;
    target: TTarget;
  }) => Promise<void>;
  onPhaseChange?: (phase: ConversationRunPhase, previousPhase?: ConversationRunPhase, trigger?: TTrigger) => Promise<void>;
};

async function* captureAgentEvents(
  events: AsyncIterable<AgentStreamEvent>,
  onEvent: (event: AgentStreamEvent) => void,
): AsyncGenerator<AgentStreamEvent, void> {
  for await (const event of events) {
    onEvent(event);
    yield event;
  }
}

export async function runConversationWithRenderer<TTarget, TTrigger = unknown>(
  options: ConversationRunOptions<TTarget, TTrigger>,
): Promise<boolean> {
  const { conversationId } = options;
  if (activeConversations.has(conversationId)) {
    return false;
  }

  activeConversations.add(conversationId);
  let phase: ConversationRunPhase = 'thinking';

  try {
    const existingSessionId = conversationSessions.get(conversationId);
    const isResume = !!existingSessionId;
    const showEnvironment = !existingSessionId;
    const sessionId = existingSessionId ?? options.createSessionId?.() ?? randomUUID();
    const runCwd = conversationCwd.get(conversationId) ?? options.defaultCwd;
    const preparedPrompt = await options.preparePrompt?.({
      conversationId,
      prompt: options.prompt,
      sourceMessageId: options.sourceMessageId,
    }) ?? { prompt: options.prompt };

    conversationSessions.set(conversationId, sessionId);

    const events = runConversationSession(conversationId, {
      mode: options.mode ?? 'code',
      prompt: preparedPrompt.prompt,
      model: conversationModels.get(conversationId),
      effort: conversationEffort.get(conversationId),
      cwd: runCwd,
      backend: options.backend ?? conversationBackend.get(conversationId),
      ...(isResume ? { resumeSessionId: sessionId } : { sessionId }),
    });

    let resolvedSessionId = sessionId;
    let finalResult = '';

    await options.render(
      { target: options.target, showEnvironment, initialMessage: options.trigger },
      captureAgentEvents(events, (event) => {
        if (event.type === 'tool' && phase !== 'tools' && phase !== 'error') {
          const previousPhase = phase;
          phase = 'tools';
          void options.onPhaseChange?.('tools', previousPhase, options.trigger);
        } else if (event.type === 'done') {
          finalResult = event.result;
          if (event.sessionId) {
            resolvedSessionId = event.sessionId;
          }
        } else if (event.type === 'error') {
          const previousPhase = phase;
          phase = 'error';
          void options.onPhaseChange?.('error', previousPhase, options.trigger);
        }

        if (
          event.type === 'environment'
          && event.environment.cwd.source === 'auto-detected'
          && event.environment.cwd.value
          && !conversationCwd.has(conversationId)
        ) {
          conversationCwd.set(conversationId, event.environment.cwd.value);
        }

        if (
          event.type === 'status'
          && event.status.startsWith('cwd:')
          && !conversationCwd.has(conversationId)
        ) {
          conversationCwd.set(conversationId, event.status.slice(4));
        }
      }),
    );

    if (finalResult && options.publishArtifacts) {
      await options.publishArtifacts({
        conversationId,
        cwd: runCwd,
        resultText: finalResult,
        sourceMessageId: options.sourceMessageId,
        target: options.target,
      });
    }

    if (phase !== 'error') {
      await options.onPhaseChange?.('done', phase, options.trigger);
    }

    conversationSessions.set(conversationId, resolvedSessionId);
    void (options.persist ?? persistState)();
    return true;
  } finally {
    activeConversations.delete(conversationId);
  }
}
