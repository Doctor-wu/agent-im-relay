import { randomUUID } from 'node:crypto';
import {
  applySessionControlCommand,
  buildAttachmentPromptContext,
  conversationBackend,
  conversationEffort,
  conversationMode,
  conversationModels,
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
  buildFeishuSessionControlPanelPayload,
  buildFeishuSessionAnchorCardPayload,
  buildSessionAnchorCard,
  buildSessionControlCard,
  createBackendConfirmationCard,
  createBackendSelectionCard,
  FEISHU_NON_SESSION_CONTROL_TEXT,
  type BackendConfirmationCard,
  type BackendSelectionCard,
  FeishuCardContext,
} from './cards.js';
import { parseAskCommand } from './commands/ask.js';
import {
  getFeishuSessionChat,
  updateFeishuSessionChat,
} from './session-chat.js';

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
  sendCard(target: FeishuTarget, card: Record<string, unknown>): Promise<string | undefined>;
  updateCard(target: FeishuTarget, messageId: string, card: Record<string, unknown>): Promise<void>;
  uploadFile(target: FeishuTarget, filePath: string): Promise<void>;
};

const pendingAttachments = new Map<string, RemoteAttachmentLike[]>();
const pendingRuns = new Map<string, PendingFeishuRun>();

function buildSessionAnchorSummary(conversationId: string): {
  backend?: string;
  model?: string;
  effort?: string;
} {
  return {
    backend: conversationBackend.get(conversationId),
    model: conversationModels.get(conversationId),
    effort: conversationEffort.get(conversationId),
  };
}

async function refreshSessionAnchor(options: {
  conversationId: string;
  target: FeishuTarget;
  transport: FeishuRuntimeTransport;
  persistState?: () => Promise<void>;
  status: 'idle' | 'running';
}): Promise<void> {
  const sessionChat = getFeishuSessionChat(options.conversationId);
  if (!sessionChat) {
    return;
  }

  const summary = {
    ...buildSessionAnchorSummary(options.conversationId),
    status: options.status,
  } as const;
  const payload = buildFeishuSessionAnchorCardPayload(
    buildSessionAnchorCard(options.conversationId, summary),
    buildFeishuCardContext(options.conversationId, options.target),
  );

  const persistSummary = async (anchorMessageId?: string): Promise<void> => {
    updateFeishuSessionChat(options.conversationId, {
      lastKnownBackend: summary.backend,
      lastKnownModel: summary.model,
      lastKnownEffort: summary.effort,
      ...(anchorMessageId ? { anchorMessageId } : {}),
      lastRunStatus: options.status,
    });
    await options.persistState?.();
  };

  if (sessionChat.anchorMessageId) {
    try {
      await options.transport.updateCard(options.target, sessionChat.anchorMessageId, payload);
      await persistSummary();
      return;
    } catch {
      const anchorMessageId = await options.transport.sendCard(options.target, payload);
      await persistSummary(anchorMessageId);
      return;
    }
  }

  const anchorMessageId = await options.transport.sendCard(options.target, payload);
  await persistSummary(anchorMessageId);
}

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

export function isFeishuDoneCommand(content: string): boolean {
  return content.trim().toLowerCase() === '/done';
}

export async function openFeishuSessionControlPanel(options: {
  conversationId: string;
  target: FeishuTarget;
  transport: FeishuRuntimeTransport;
  requireKnownSessionChat?: boolean;
}): Promise<{ kind: 'opened' | 'not-session-chat' }> {
  const sessionChat = options.requireKnownSessionChat
    ? getFeishuSessionChat(options.target.chatId)
    : undefined;

  if (options.requireKnownSessionChat && !sessionChat) {
    await options.transport.sendText(options.target, FEISHU_NON_SESSION_CONTROL_TEXT);
    return { kind: 'not-session-chat' };
  }

  const conversationId = sessionChat?.sessionChatId ?? options.conversationId;
  await options.transport.sendCard(
    options.target,
    buildFeishuSessionControlPanelPayload(
      conversationId,
      buildFeishuCardContext(conversationId, options.target),
    ),
  );
  return { kind: 'opened' };
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

export function drainPendingFeishuAttachments(conversationId: string): RemoteAttachmentLike[] {
  return takePendingFeishuAttachments(conversationId);
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

async function runFeishuBestEffort(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.warn(`[feishu] failed to ${label}:`, error);
  }
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
  persistState?: () => Promise<void>;
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
  await runFeishuBestEffort('send startup text', async () => {
    await options.transport.sendText(
      options.target,
      options.mode === 'ask' ? 'Thinking…' : 'Starting run…',
    );
  });
  await runFeishuBestEffort('send session control card', async () => {
    const sessionChat = getFeishuSessionChat(options.conversationId);
    if (sessionChat) {
      await refreshSessionAnchor({
        conversationId: options.conversationId,
        target: options.target,
        transport: options.transport,
        persistState: options.persistState,
        status: 'running',
      });
      return;
    }

    await options.transport.sendCard(
      options.target,
      buildFeishuSessionControlPanelPayload(
        options.conversationId,
        buildFeishuCardContext(options.conversationId, options.target),
      ),
    );
  });

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
        await runFeishuBestEffort('send tools status', async () => {
          await options.transport.sendText(options.target, 'Running tools…');
        });
      }
    },
  });

  await runFeishuBestEffort('refresh session control anchor', async () => {
    await refreshSessionAnchor({
      conversationId: options.conversationId,
      target: options.target,
      transport: options.transport,
      persistState: options.persistState,
      status: 'idle',
    });
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
  persistState?: () => Promise<void>;
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
    persistState: options.persistState,
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

  const sessionChat = getFeishuSessionChat(result.conversationId);
  if (sessionChat) {
    updateFeishuSessionChat(result.conversationId, {
      ...buildSessionAnchorSummary(result.conversationId),
      lastRunStatus: result.kind === 'interrupt' ? 'idle' : sessionChat.lastRunStatus ?? 'idle',
    });
    await options.persist?.();
    await runFeishuBestEffort('refresh session control anchor', async () => {
      await refreshSessionAnchor({
        conversationId: result.conversationId,
        target: options.target,
        transport: options.transport,
        persistState: options.persist,
        status: 'idle',
      });
    });
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
