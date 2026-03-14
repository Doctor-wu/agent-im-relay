import {
  conversationMode,
  evaluateConversationRunRequest,
  runPlatformConversation,
  applySessionControlCommand,
  type AgentStreamEvent,
  type BackendName,
  type RemoteAttachmentLike,
  type SessionControlCommand,
} from '@agent-im-relay/core';
import { streamAgentToTelegram, type TelegramTarget, type TelegramTransport } from './stream.js';

export type { TelegramTarget, TelegramTransport };

export type PendingTelegramRun = {
  conversationId: string;
  target: TelegramTarget;
  prompt: string;
  mode: 'code' | 'ask';
  sourceMessageId?: string;
  attachments?: RemoteAttachmentLike[];
};

export type TelegramRunGateResult =
  | { kind: 'blocked'; reason: 'backend-selection' }
  | { kind: 'ready'; backend: BackendName | undefined };

export type TelegramConversationLifecycle = {
  onError?(message: string): Promise<void>;
  onFinalOutput?(output: string): Promise<void>;
};

const pendingRuns = new Map<string, PendingTelegramRun>();

export function resolveTelegramConversationId(chatId: number, threadId?: number): string {
  return threadId ? `tg-${chatId}-${threadId}` : `tg-${chatId}`;
}

export function resolvePromptMode(text: string): { mode: 'code' | 'ask'; prompt: string } {
  const askMatch = text.match(/^\/ask\s+([\s\S]+)$/i);
  if (askMatch) {
    return { mode: 'ask', prompt: askMatch[1]!.trim() };
  }
  return { mode: 'code', prompt: text.trim() };
}

export function beginTelegramConversationRun(
  conversationId: string,
): TelegramRunGateResult {
  const evaluation = evaluateConversationRunRequest({
    conversationId,
    requireBackendSelection: true,
  });

  if (evaluation.kind === 'setup-required') {
    return { kind: 'blocked', reason: 'backend-selection' };
  }

  return { kind: 'ready', backend: evaluation.backend };
}

export function dispatchTelegramControlAction(action: SessionControlCommand) {
  return applySessionControlCommand(action);
}

export async function runTelegramConversation(options: {
  conversationId: string;
  target: TelegramTarget;
  prompt: string;
  mode: 'code' | 'ask';
  transport: TelegramTransport;
  defaultCwd: string;
  streamUpdateIntervalMs: number;
  messageCharLimit: number;
  sourceMessageId?: string;
  attachments?: RemoteAttachmentLike[];
  persistState?: () => Promise<void>;
  lifecycle?: TelegramConversationLifecycle;
}): Promise<{ kind: 'blocked' | 'started' | 'busy' }> {
  const gate = beginTelegramConversationRun(options.conversationId);

  if (gate.kind === 'blocked') {
    storePendingRun({
      conversationId: options.conversationId,
      target: options.target,
      prompt: options.prompt,
      mode: options.mode,
      sourceMessageId: options.sourceMessageId,
      attachments: options.attachments,
    });
    return { kind: 'blocked' };
  }

  pendingRuns.delete(options.conversationId);
  conversationMode.set(options.conversationId, options.mode);

  const showEnvironment = true;

  const started = await runPlatformConversation({
    conversationId: options.conversationId,
    target: options.target,
    prompt: options.prompt,
    mode: options.mode,
    sourceMessageId: options.sourceMessageId,
    backend: gate.backend,
    defaultCwd: options.defaultCwd,
    attachments: options.attachments,
    persist: options.persistState,
    render: (renderOptions, events) =>
      renderForTelegram(
        options.transport,
        renderOptions.target,
        events,
        renderOptions.showEnvironment ?? showEnvironment,
        options.streamUpdateIntervalMs,
        options.messageCharLimit,
        options.lifecycle,
      ),
    publishArtifacts: async ({ files, warnings, target }) => {
      for (const filePath of files) {
        await options.transport.sendDocument(target, filePath);
      }
      if (warnings.length > 0) {
        await options.transport.sendMessage(target, warnings.join('\n'));
      }
    },
  });

  return started ? { kind: 'started' } : { kind: 'busy' };
}

async function renderForTelegram(
  transport: TelegramTransport,
  target: TelegramTarget,
  events: AsyncIterable<AgentStreamEvent>,
  showEnvironment: boolean,
  streamUpdateIntervalMs: number,
  messageCharLimit: number,
  lifecycle?: TelegramConversationLifecycle,
): Promise<void> {
  if (lifecycle?.onFinalOutput || lifecycle?.onError) {
    let finalText = '';
    let errorText = '';

    for await (const event of events) {
      if (event.type === 'done') {
        finalText = event.result;
      } else if (event.type === 'error') {
        errorText = event.error;
      }
    }

    if (errorText) {
      await lifecycle.onError?.(`❌ ${errorText}`);
      return;
    }

    if (finalText) {
      await lifecycle.onFinalOutput?.(finalText);
    }
    return;
  }

  await streamAgentToTelegram(transport, target, events, {
    showEnvironment,
    streamUpdateIntervalMs,
    messageCharLimit,
  });
}

function storePendingRun(run: PendingTelegramRun): void {
  pendingRuns.set(run.conversationId, run);
}

export function takePendingTelegramRun(conversationId: string): PendingTelegramRun | undefined {
  const run = pendingRuns.get(conversationId);
  pendingRuns.delete(conversationId);
  return run;
}

export function resetTelegramRuntimeForTests(): void {
  pendingRuns.clear();
}
