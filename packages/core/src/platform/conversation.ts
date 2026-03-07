import type { AgentBackend, BackendName } from '../agent/backend.js';
import type { AgentMode } from '../agent/tools.js';
import type { AgentStreamEvent } from '../agent/session.js';
import { stageOutgoingArtifacts, type RemoteAttachmentLike } from '../runtime/files.js';
import { prepareAttachmentPrompt } from '../runtime/files.js';
import { runConversationWithRenderer, type ConversationRunPhase } from '../runtime/conversation-runner.js';
import { conversationBackend } from '../state.js';
import { applySessionControlCommand } from '../session-control/controller.js';
import type { SessionControlCommand } from '../session-control/types.js';

export type ConversationRunEvaluation =
  | {
    kind: 'setup-required';
    conversationId: string;
    reason: 'backend-selection';
  }
  | {
    kind: 'ready';
    conversationId: string;
    backend: BackendName | undefined;
  };

export type ConversationControlAction = SessionControlCommand;

export type ConversationControlResult =
  | {
    kind: 'interrupt';
    conversationId: string;
    interrupted: boolean;
  }
  | {
    kind: 'done';
    conversationId: string;
    continuationCleared: boolean;
  }
  | {
    kind: 'backend';
    conversationId: string;
  }
  | {
    kind: 'backend-confirmation';
    conversationId: string;
    currentBackend: BackendName;
    requestedBackend: BackendName;
  }
  | {
    kind: 'confirm-backend';
    conversationId: string;
    backend: BackendName;
    continuationCleared: boolean;
  }
  | {
    kind: 'cancel-backend';
    conversationId: string;
  }
  | {
    kind: 'model';
    conversationId: string;
  }
  | {
    kind: 'effort';
    conversationId: string;
  };

type RunPlatformConversationOptions<TTarget, TTrigger = unknown> = {
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
  attachments?: RemoteAttachmentLike[];
  attachmentFetchImpl?: typeof fetch;
  render: (
    options: { target: TTarget; showEnvironment: boolean; initialMessage?: TTrigger },
    events: AsyncIterable<AgentStreamEvent>,
  ) => Promise<void>;
  publishArtifacts?: (options: {
    conversationId: string;
    cwd: string;
    files: string[];
    warnings: string[];
    sourceMessageId?: string;
    target: TTarget;
  }) => Promise<void>;
  onPhaseChange?: (phase: ConversationRunPhase, previousPhase?: ConversationRunPhase, trigger?: TTrigger) => Promise<void>;
};

export function evaluateConversationRunRequest(options: {
  conversationId: string;
  requireBackendSelection?: boolean;
}): ConversationRunEvaluation {
  const backend = conversationBackend.get(options.conversationId);
  if (options.requireBackendSelection && !backend) {
    return {
      kind: 'setup-required',
      conversationId: options.conversationId,
      reason: 'backend-selection',
    };
  }

  return {
    kind: 'ready',
    conversationId: options.conversationId,
    backend,
  };
}

export function applyConversationControlAction(action: ConversationControlAction): ConversationControlResult {
  const result = applySessionControlCommand(action);

  if (result.kind === 'interrupt') {
    return {
      kind: 'interrupt',
      conversationId: result.conversationId,
      interrupted: result.interrupted,
    };
  }

  if (result.kind === 'done') {
    return {
      kind: 'done',
      conversationId: result.conversationId,
      continuationCleared: result.clearContinuation,
    };
  }

  if (result.kind === 'backend') {
    if (result.requiresConfirmation) {
      return {
        kind: 'backend-confirmation',
        conversationId: result.conversationId,
        currentBackend: result.currentBackend!,
        requestedBackend: result.requestedBackend!,
      };
    }

    return {
      kind: 'backend',
      conversationId: result.conversationId,
    };
  }

  if (result.kind === 'confirm-backend') {
    return {
      kind: 'confirm-backend',
      conversationId: result.conversationId,
      backend: result.backend,
      continuationCleared: result.clearContinuation,
    };
  }

  if (result.kind === 'cancel-backend') {
    return {
      kind: 'cancel-backend',
      conversationId: result.conversationId,
    };
  }

  if (result.kind === 'model') {
    return {
      kind: 'model',
      conversationId: result.conversationId,
    };
  }

  return {
    kind: 'effort',
    conversationId: result.conversationId,
  };
}

export async function runPlatformConversation<TTarget, TTrigger = unknown>(
  options: RunPlatformConversationOptions<TTarget, TTrigger>,
): Promise<boolean> {
  return runConversationWithRenderer({
    conversationId: options.conversationId,
    target: options.target,
    prompt: options.prompt,
    mode: options.mode,
    trigger: options.trigger,
    sourceMessageId: options.sourceMessageId,
    backend: options.backend,
    defaultCwd: options.defaultCwd,
    createSessionId: options.createSessionId,
    persist: options.persist,
    preparePrompt: async ({ conversationId, prompt, sourceMessageId }) => {
      if (!options.attachments?.length) {
        return { prompt };
      }

      return prepareAttachmentPrompt({
        conversationId,
        prompt,
        attachments: options.attachments,
        sourceMessageId,
        fetchImpl: options.attachmentFetchImpl,
      });
    },
    render: options.render,
    publishArtifacts: options.publishArtifacts
      ? async ({ conversationId, cwd, resultText, sourceMessageId, target }) => {
        const staged = await stageOutgoingArtifacts({
          conversationId,
          cwd,
          resultText,
          sourceMessageId,
        });

        await options.publishArtifacts?.({
          conversationId,
          cwd,
          files: staged.files,
          warnings: staged.warnings,
          sourceMessageId,
          target,
        });
      }
      : undefined,
    onPhaseChange: options.onPhaseChange,
  });
}
