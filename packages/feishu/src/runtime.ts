import { randomUUID } from 'node:crypto';
import {
  applyConversationControlAction,
  buildAttachmentPromptContext,
  conversationBackend,
  conversationMode,
  evaluateConversationRunRequest,
  runPlatformConversation,
  type AgentStreamEvent,
  type BackendName,
  type DownloadedAttachment,
  type RemoteAttachmentLike,
} from '@agent-im-relay/core';
import {
  buildFeishuBackendConfirmationCardPayload,
  buildFeishuBackendSelectionCardPayload,
  buildFeishuSessionControlCardPayload,
  buildSessionControlCard,
  createBackendConfirmationCard,
  createBackendSelectionCard,
  type BackendConfirmationCard,
  type BackendSelectionCard,
  type FeishuCardContext,
  type SessionControlCard,
} from './cards.js';
import { parseAskCommand } from './commands/ask.js';

export type FeishuTarget = {
  chatId: string;
  replyToMessageId?: string;
};

export type PendingFeishuRun = {
  conversationId: string;
  target: FeishuTarget;
  prompt: string;
  mode: 'code' | 'ask';
  sourceMessageId?: string;
  attachments?: RemoteAttachmentLike[];
  attachmentFetchImpl?: typeof fetch;
};

export type FeishuRuntimeTransport = {
  sendText(target: FeishuTarget, text: string): Promise<void>;
  sendCard(target: FeishuTarget, card: Record<string, unknown>): Promise<void>;
  uploadFile(target: FeishuTarget, filePath: string): Promise<void>;
};

const pendingAttachments = new Map<string, RemoteAttachmentLike[]>();

export type FeishuRunGateResult =
  | {
    kind: 'blocked';
    reason: 'backend-selection';
    card: BackendSelectionCard;
  }
  | {
    kind: 'ready';
    backend: BackendName | undefined;
  };

export function buildFeishuCardContext(
  conversationId: string,
  target: FeishuTarget,
  extra: {
    prompt?: string;
    mode?: 'code' | 'ask';
  } = {},
): FeishuCardContext {
  return {
    conversationId,
    chatId: target.chatId,
    replyToMessageId: target.replyToMessageId,
    prompt: extra.prompt,
    mode: extra.mode,
  };
}

export function beginFeishuConversationRun(
  options: {
    conversationId: string;
    prompt: string;
  },
): FeishuRunGateResult {
  const evaluation = evaluateConversationRunRequest({
    conversationId: options.conversationId,
    requireBackendSelection: true,
  });
  if (evaluation.kind === 'setup-required') {
    return {
      kind: 'blocked',
      reason: 'backend-selection',
      card: createBackendSelectionCard(options.conversationId, options.prompt),
    };
  }

  return {
    kind: 'ready',
    backend: evaluation.backend,
  };
}

export type FeishuCardAction =
  | { conversationId: string; type: 'interrupt' }
  | { conversationId: string; type: 'done' }
  | { conversationId: string; type: 'backend'; value: BackendName }
  | { conversationId: string; type: 'confirm-backend'; value: BackendName }
  | { conversationId: string; type: 'cancel-backend' }
  | { conversationId: string; type: 'model'; value: string }
  | { conversationId: string; type: 'effort'; value: string };

export function dispatchFeishuCardAction(action: FeishuCardAction) {
  return applyConversationControlAction(action);
}

export function requestBackendChange(
  conversationId: string,
  requestedBackend: BackendName,
): BackendConfirmationCard {
  const currentBackend = conversationBackend.get(conversationId) ?? 'claude';
  applyConversationControlAction({
    conversationId,
    type: 'backend',
    value: requestedBackend,
  });
  return createBackendConfirmationCard(conversationId, currentBackend, requestedBackend);
}

export function confirmBackendChange(
  conversationId: string,
  requestedBackend: BackendName,
): {
  backend: BackendName;
  continuationCleared: boolean;
} {
  const result = applyConversationControlAction({
    conversationId,
    type: 'confirm-backend',
    value: requestedBackend,
  });

  return {
    backend: result.kind === 'confirm-backend' ? result.backend : requestedBackend,
    continuationCleared: result.kind === 'confirm-backend' ? result.continuationCleared : false,
  };
}

export function resolveFeishuMessageRequest(content: string): {
  mode: 'code' | 'ask';
  prompt: string;
} {
  const askPrompt = parseAskCommand(content);
  if (askPrompt) {
    return {
      mode: 'ask',
      prompt: askPrompt,
    };
  }

  return {
    mode: 'code',
    prompt: content.trim(),
  };
}

export function rememberFeishuConversationMode(
  conversationId: string,
  mode: 'code' | 'ask',
): void {
  conversationMode.set(conversationId, mode);
}

export function queuePendingFeishuAttachments(
  conversationId: string,
  attachments: RemoteAttachmentLike[],
): void {
  if (attachments.length === 0) {
    return;
  }

  const current = pendingAttachments.get(conversationId) ?? [];
  pendingAttachments.set(conversationId, [...current, ...attachments]);
}

function takePendingFeishuAttachments(conversationId: string): RemoteAttachmentLike[] {
  const attachments = pendingAttachments.get(conversationId) ?? [];
  pendingAttachments.delete(conversationId);
  return attachments;
}

function formatEnvironmentSummary(event: Extract<AgentStreamEvent, { type: 'environment' }>): string {
  const cwd = event.environment.cwd.value ?? 'unknown cwd';
  const backend = event.environment.backend;
  const mode = event.environment.mode;
  return `Environment: backend=${backend}, mode=${mode}, cwd=${cwd}`;
}

async function streamAgentToFeishu(
  transport: FeishuRuntimeTransport,
  target: FeishuTarget,
  events: AsyncIterable<AgentStreamEvent>,
): Promise<void> {
  let finalText = '';
  const chunks: string[] = [];

  for await (const event of events) {
    if (event.type === 'environment') {
      await transport.sendText(target, formatEnvironmentSummary(event));
      continue;
    }

    if (event.type === 'text') {
      chunks.push(event.delta);
      continue;
    }

    if (event.type === 'error') {
      await transport.sendText(target, `❌ ${event.error}`);
      return;
    }

    if (event.type === 'done') {
      finalText = event.result;
    }
  }

  const output = finalText || chunks.join('').trim();
  if (output) {
    await transport.sendText(target, output);
  }
}

export async function runFeishuConversation(options: {
  conversationId: string;
  target: FeishuTarget;
  prompt: string;
  mode: 'code' | 'ask';
  transport: FeishuRuntimeTransport;
  defaultCwd: string;
  sourceMessageId?: string;
  attachments?: RemoteAttachmentLike[];
  attachmentFetchImpl?: typeof fetch;
}): Promise<{ kind: 'blocked' | 'started' | 'busy' }> {
  const gate = beginFeishuConversationRun({
    conversationId: options.conversationId,
    prompt: options.prompt,
  });

  const mergedAttachments = [
    ...takePendingFeishuAttachments(options.conversationId),
    ...(options.attachments ?? []),
  ];

  if (gate.kind === 'blocked') {
    await options.transport.sendCard(
      options.target,
      buildFeishuBackendSelectionCardPayload(
        gate.card,
        buildFeishuCardContext(options.conversationId, options.target, {
          prompt: options.prompt,
          mode: options.mode,
        }),
      ),
    );
    return { kind: 'blocked' };
  }

  rememberFeishuConversationMode(options.conversationId, options.mode);
  await options.transport.sendText(
    options.target,
    options.mode === 'ask' ? 'Thinking…' : 'Starting run…',
  );

  const started = await runPlatformConversation({
    conversationId: options.conversationId,
    target: options.target,
    prompt: options.prompt,
    mode: options.mode,
    sourceMessageId: options.sourceMessageId,
    backend: gate.backend,
    defaultCwd: options.defaultCwd,
    attachments: mergedAttachments,
    attachmentFetchImpl: options.attachmentFetchImpl,
    render: ({ target }, events) => streamAgentToFeishu(options.transport, target, events),
    publishArtifacts: async ({ files, warnings, target }) => {
      for (const filePath of files) {
        await options.transport.uploadFile(target, filePath);
      }

      if (warnings.length > 0) {
        await options.transport.sendText(target, warnings.join('\n'));
      }
    },
    onPhaseChange: async (phase) => {
      if (phase === 'tools') {
        await options.transport.sendText(options.target, 'Running tools…');
      }
    },
  });

  if (started) {
    await options.transport.sendCard(
      options.target,
      buildFeishuSessionControlCardPayload(
        buildSessionControlCard(options.conversationId),
        buildFeishuCardContext(options.conversationId, options.target),
      ),
    );
    return { kind: 'started' };
  }

  await options.transport.sendText(options.target, 'Conversation is already running.');
  return { kind: 'busy' };
}

export async function handleFeishuControlAction(options: {
  action: FeishuCardAction;
  target: FeishuTarget;
  transport: FeishuRuntimeTransport;
}): Promise<
  | { kind: 'applied' }
  | { kind: 'backend-confirmation'; card: BackendConfirmationCard }
> {
  const result = dispatchFeishuCardAction(options.action);

  if (result.kind === 'backend-confirmation') {
    return {
      kind: 'backend-confirmation',
      card: createBackendConfirmationCard(result.conversationId, result.currentBackend, result.requestedBackend),
    };
  }

  const text = (() => {
    switch (result.kind) {
      case 'interrupt':
        return result.interrupted ? 'Interrupted current run.' : 'No active run to interrupt.';
      case 'done':
        return result.continuationCleared ? 'Continuation cleared.' : 'No saved continuation to clear.';
      case 'confirm-backend':
        return `Backend switched to ${result.backend}.`;
      case 'cancel-backend':
        return 'Backend switch canceled.';
      case 'model':
        return 'Model updated.';
      case 'effort':
        return 'Effort updated.';
      case 'backend':
        return 'Backend updated.';
      default:
        return 'Action applied.';
    }
  })();

  await options.transport.sendText(options.target, text);
  return { kind: 'applied' };
}

export { buildSessionControlCard };
