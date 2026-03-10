import { randomUUID } from 'node:crypto';
import { runConversationSession } from '../agent/runtime.js';
import { getBackendSupportedModels, isBackendModelSupported } from '../agent/backend.js';
import {
  activeConversations,
  conversationBackend,
  conversationCwd,
  conversationEffort,
  conversationModels,
  conversationSessions,
  persistState,
  threadSessionBindings,
} from '../state.js';
import type { AgentMode } from '../agent/tools.js';
import type { AgentBackend, BackendName } from '../agent/backend.js';
import type { AgentStreamEvent } from '../agent/session.js';
import {
  confirmThreadSessionBinding,
  invalidateThreadSessionBinding,
  openThreadSessionBinding,
  resolveThreadResumeMode,
  updateThreadContinuationSnapshot,
} from '../thread-session/manager.js';
import type { ThreadContinuationSnapshot, ThreadContinuationStopReason } from '../thread-session/types.js';

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
  onEvent: (event: AgentStreamEvent) => void | Promise<void>,
): AsyncGenerator<AgentStreamEvent, void> {
  for await (const event of events) {
    await onEvent(event);
    yield event;
  }
}

function resolveBackendName(
  backend: BackendName | AgentBackend | undefined,
  existingBackend: BackendName | undefined,
): BackendName {
  if (typeof backend === 'string') {
    return backend;
  }

  if (backend && typeof backend === 'object') {
    return backend.name;
  }

  return existingBackend ?? 'claude';
}

function resolveConfiguredModel(
  conversationId: string,
  backendName: BackendName,
): string | undefined {
  const configuredModel = conversationModels.get(conversationId);
  if (!configuredModel) {
    return undefined;
  }

  const supportedModels = getBackendSupportedModels(backendName);
  if (supportedModels.length === 0) {
    return configuredModel;
  }

  if (isBackendModelSupported(backendName, configuredModel)) {
    return configuredModel;
  }

  conversationModels.delete(conversationId);
  return undefined;
}

function inferStopReason(error: string): ThreadContinuationStopReason {
  if (/timed out/i.test(error)) {
    return 'timeout';
  }

  if (/aborted|interrupt/i.test(error)) {
    return 'interrupted';
  }

  return 'error';
}

function summarizeConversationState(finalResult: string, assistantOutput: string, prompt: string): string {
  const summary = finalResult.trim() || assistantOutput.trim() || prompt.trim();
  return summary.slice(0, 4000);
}

function buildNextStep(whyStopped: ThreadContinuationStopReason): string {
  if (whyStopped === 'completed') {
    return 'Continue the existing conversation from the most recent completed response.';
  }

  if (whyStopped === 'timeout' || whyStopped === 'interrupted') {
    return 'Resume the interrupted conversation from the latest preserved context.';
  }

  return 'Recover from the last error and continue the conversation.';
}

function buildSnapshotResumePrompt(snapshot: ThreadContinuationSnapshot, prompt: string): string {
  return [
    'Continue the existing conversation thread using this continuation snapshot.',
    `Task summary: ${snapshot.taskSummary}`,
    snapshot.lastKnownCwd ? `Last known working directory: ${snapshot.lastKnownCwd}` : '',
    snapshot.model ? `Previous model: ${snapshot.model}` : '',
    snapshot.effort ? `Previous effort: ${snapshot.effort}` : '',
    `Previous stop reason: ${snapshot.whyStopped}`,
    snapshot.nextStep ? `Suggested next step: ${snapshot.nextStep}` : '',
    '',
    'New user message:',
    prompt,
  ].filter(Boolean).join('\n');
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
    const persist = options.persist ?? persistState;
    const existingBinding = threadSessionBindings.get(conversationId);
    const backendName = resolveBackendName(
      options.backend,
      conversationBackend.get(conversationId) ?? existingBinding?.backend,
    );
    const showEnvironment = !existingBinding;
    const runCwd = conversationCwd.get(conversationId) ?? options.defaultCwd;
    const preparedPrompt = await options.preparePrompt?.({
      conversationId,
      prompt: options.prompt,
      sourceMessageId: options.sourceMessageId,
    }) ?? { prompt: options.prompt };
    const model = resolveConfiguredModel(conversationId, backendName);
    openThreadSessionBinding({ conversationId, backend: backendName });
    const resumeMode = resolveThreadResumeMode(conversationId);

    if (resumeMode.type !== 'native-resume') {
      conversationSessions.delete(conversationId);
    }

    const prompt = resumeMode.type === 'snapshot-resume'
      ? buildSnapshotResumePrompt(resumeMode.snapshot, preparedPrompt.prompt)
      : preparedPrompt.prompt;
    const sessionId = options.createSessionId?.() ?? randomUUID();

    const events = runConversationSession(conversationId, {
      mode: options.mode ?? 'code',
      prompt,
      model,
      effort: conversationEffort.get(conversationId),
      cwd: runCwd,
      backend: options.backend ?? backendName,
      ...(resumeMode.type === 'native-resume'
        ? { resumeSessionId: resumeMode.nativeSessionId }
        : { sessionId }),
    });

    let resolvedSessionId = resumeMode.type === 'native-resume'
      ? resumeMode.nativeSessionId
      : sessionId;
    let finalResult = '';
    let assistantOutput = '';
    let stopReason: ThreadContinuationStopReason | undefined;
    let nativeResumeReconfirmed = false;

    await options.render(
      { target: options.target, showEnvironment, initialMessage: options.trigger },
      captureAgentEvents(events, async (event) => {
        if (event.type === 'tool' && phase !== 'tools' && phase !== 'error') {
          const previousPhase = phase;
          phase = 'tools';
          void options.onPhaseChange?.('tools', previousPhase, options.trigger);
        } else if (event.type === 'session') {
          resolvedSessionId = event.sessionId;
          nativeResumeReconfirmed = true;
          if (threadSessionBindings.has(conversationId)) {
            confirmThreadSessionBinding({
              conversationId,
              nativeSessionId: event.sessionId,
            });
            await persist();
          }
        } else if (event.type === 'session-invalidated') {
          if (threadSessionBindings.has(conversationId)) {
            invalidateThreadSessionBinding({ conversationId });
            await persist();
          }
        } else if (event.type === 'text') {
          assistantOutput += event.delta;
        } else if (event.type === 'done') {
          finalResult = event.result;
          stopReason = 'completed';
          if (event.sessionId) {
            resolvedSessionId = event.sessionId;
            if (threadSessionBindings.has(conversationId)) {
              confirmThreadSessionBinding({
                conversationId,
                nativeSessionId: event.sessionId,
              });
            }
          }
        } else if (event.type === 'error') {
          const previousPhase = phase;
          phase = 'error';
          stopReason = inferStopReason(event.error);
          void options.onPhaseChange?.('error', previousPhase, options.trigger);
        }

        if (
          event.type === 'environment'
          && event.environment.cwd.source === 'auto-detected'
          && event.environment.cwd.value
        ) {
          conversationCwd.set(conversationId, event.environment.cwd.value);
        }

        if (
          event.type === 'status'
          && event.status.startsWith('cwd:')
        ) {
          conversationCwd.set(conversationId, event.status.slice(4));
        }
      }),
    );

    const finalBinding = threadSessionBindings.get(conversationId);
    if (!finalBinding) {
      await persist();
      return true;
    }

    updateThreadContinuationSnapshot({
      conversationId,
      taskSummary: summarizeConversationState(finalResult, assistantOutput, options.prompt),
      lastKnownCwd: conversationCwd.get(conversationId) ?? runCwd,
      model: conversationModels.get(conversationId),
      effort: conversationEffort.get(conversationId),
      whyStopped: stopReason ?? 'completed',
      nextStep: buildNextStep(stopReason ?? 'completed'),
      updatedAt: new Date().toISOString(),
    });

    if (finalResult && options.publishArtifacts) {
      await options.publishArtifacts({
        conversationId,
        cwd: conversationCwd.get(conversationId) ?? runCwd,
        resultText: finalResult,
        sourceMessageId: options.sourceMessageId,
        target: options.target,
      });
    }

    if (phase !== 'error') {
      await options.onPhaseChange?.('done', phase, options.trigger);
    }

    if (finalBinding.nativeSessionStatus === 'confirmed' && finalBinding.nativeSessionId) {
      conversationSessions.set(conversationId, finalBinding.nativeSessionId);
    }
    await persist();
    return true;
  } finally {
    activeConversations.delete(conversationId);
  }
}
