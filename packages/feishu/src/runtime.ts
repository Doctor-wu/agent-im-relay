import { randomUUID } from 'node:crypto';
import {
  applySessionControlCommand,
  buildAttachmentPromptContext,
  conversationBackend,
  conversationMode,
  evaluateConversationRunRequest,
  runPlatformConversation,
  type AgentStreamEvent,
  type BackendName,
  type DownloadedAttachment,
  type RemoteAttachmentLike,
  type SessionControlCommand,
  type SessionControlResult,
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
const pendingRuns = new Map<string, PendingFeishuRun>();

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

export type FeishuCardAction = SessionControlCommand;

export function dispatchFeishuCardAction(action: FeishuCardAction): SessionControlResult {
  return applySessionControlCommand(action);
}

export function requestBackendChange(
  conversationId: string,
  requestedBackend: BackendName,
): BackendConfirmationCard | null {
  const result = dispatchFeishuCardAction({
    conversationId,
    type: 'backend',
    value: requestedBackend,
  });

  if (!result.requiresConfirmation || result.kind !== 'backend') {
    return null;
  }

  return createBackendConfirmationCard(
    conversationId,
    result.currentBackend ?? conversationBackend.get(conversationId) ?? 'claude',
    result.requestedBackend ?? requestedBackend,
  );
}

export function confirmBackendChange(
  conversationId: string,
  requestedBackend: BackendName,
): SessionControlResult {
  return dispatchFeishuCardAction({
    conversationId,
    type: 'confirm-backend',
    value: requestedBackend,
  });
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

function storePendingFeishuRun(run: PendingFeishuRun): void {
  pendingRuns.set(run.conversationId, run);
}

function takePendingFeishuRun(conversationId: string): PendingFeishuRun | undefined {
  const pendingRun = pendingRuns.get(conversationId);
  pendingRuns.delete(conversationId);
  return pendingRun;
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
  showEnvironment: boolean,
): Promise<void> {
  let finalText = '';
  const chunks: string[] = [];

  for await (const event of events) {
    if (event.type === 'environment') {
      if (!showEnvironment) {
        continue;
      }
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
    storePendingFeishuRun({
      conversationId: options.conversationId,
      target: options.target,
      prompt: options.prompt,
      mode: options.mode,
      sourceMessageId: options.sourceMessageId,
      attachments: mergedAttachments,
      attachmentFetchImpl: options.attachmentFetchImpl,
    });
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

  pendingRuns.delete(options.conversationId);
  rememberFeishuConversationMode(options.conversationId, options.mode);
  await options.transport.sendText(
    options.target,
    options.mode === 'ask' ? 'Thinking…' : 'Starting run…',
  );
  await options.transport.sendCard(
    options.target,
    buildFeishuSessionControlCardPayload(
      buildSessionControlCard(options.conversationId),
      buildFeishuCardContext(options.conversationId, options.target),
    ),
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
    render: ({ target, showEnvironment }, events) =>
      streamAgentToFeishu(options.transport, target, events, showEnvironment),
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
    return { kind: 'started' };
  }

  await options.transport.sendText(options.target, 'Conversation is already running.');
  return { kind: 'busy' };
}

export async function resumePendingFeishuRun(options: {
  conversationId: string;
  transport: FeishuRuntimeTransport;
  defaultCwd: string;
  fallback?: Omit<PendingFeishuRun, 'conversationId'>;
}): Promise<{ kind: 'none' | 'blocked' | 'started' | 'busy' }> {
  const pending = takePendingFeishuRun(options.conversationId);
  const run = pending ?? (options.fallback
    ? {
      conversationId: options.conversationId,
      ...options.fallback,
    }
    : undefined);

  if (!run) {
    return { kind: 'none' };
  }

  return runFeishuConversation({
    conversationId: run.conversationId,
    target: run.target,
    prompt: run.prompt,
    mode: run.mode,
    transport: options.transport,
    defaultCwd: options.defaultCwd,
    sourceMessageId: run.sourceMessageId,
    attachments: run.attachments,
    attachmentFetchImpl: run.attachmentFetchImpl,
  });
}

export async function handleFeishuControlAction(options: {
  action: FeishuCardAction;
  target: FeishuTarget;
  transport: FeishuRuntimeTransport;
  persist?: () => Promise<void>;
}): Promise<
  | { kind: 'applied' }
  | { kind: 'backend-confirmation'; card: BackendConfirmationCard }
> {
  const result = dispatchFeishuCardAction(options.action);

  if (result.requiresConfirmation && result.kind === 'backend') {
    return {
      kind: 'backend-confirmation',
      card: createBackendConfirmationCard(result.conversationId, result.currentBackend!, result.requestedBackend!),
    };
  }

  if (result.persist) {
    await options.persist?.();
  }

  const text = (() => {
    switch (result.summaryKey) {
      case 'interrupt.ok':
        return 'Interrupted current run.';
      case 'interrupt.noop':
        return 'No active run to interrupt.';
      case 'done.ok':
        return 'Continuation cleared.';
      case 'done.noop':
        return 'No saved continuation to clear.';
      case 'backend.cancelled':
      case 'backend.cancelled-noop':
        return 'Backend switch canceled.';
      case 'backend.updated':
        return result.kind === 'confirm-backend'
          ? `Backend switched to ${result.backend}.`
          : 'Backend updated.';
      case 'model.updated':
      case 'model.noop':
        return 'Model updated.';
      case 'effort.updated':
      case 'effort.noop':
        return 'Effort updated.';
      default:
        return 'Action applied.';
    }
  })();

  await options.transport.sendText(options.target, text);
  return { kind: 'applied' };
}

export function resetFeishuRuntimeForTests(): void {
  pendingAttachments.clear();
  pendingRuns.clear();
}

export { buildSessionControlCard };
