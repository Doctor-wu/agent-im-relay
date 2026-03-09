import {
  markFeishuDispatchMessageEmitted,
  type FeishuDispatchMessageKind,
} from './launch-state.js';
import { buildFeishuInterruptCardPayload, type FeishuCardContext } from './cards.js';

export type FeishuPresentationTarget = {
  chatId: string;
  replyToMessageId?: string;
};

export type FeishuPresentationTransport = {
  sendText(target: FeishuPresentationTarget, text: string): Promise<void>;
  sendCard(target: FeishuPresentationTarget, card: Record<string, unknown>): Promise<string | undefined>;
};

export type FeishuPresentationResult = {
  kind: 'emitted' | 'skipped';
};

function markDispatchMessage(
  dispatchId: string,
  kind: FeishuDispatchMessageKind,
): FeishuPresentationResult {
  return markFeishuDispatchMessageEmitted(dispatchId, kind)
    ? { kind: 'emitted' }
    : { kind: 'skipped' };
}

function buildCardContext(conversationId: string, target: FeishuPresentationTarget): FeishuCardContext {
  return {
    conversationId,
    chatId: target.chatId,
    replyToMessageId: target.replyToMessageId,
  };
}

export async function presentFeishuInterruptCard(options: {
  dispatchId: string;
  conversationId: string;
  target: FeishuPresentationTarget;
  transport: FeishuPresentationTransport;
}): Promise<FeishuPresentationResult> {
  const result = markDispatchMessage(options.dispatchId, 'interrupt-card');
  if (result.kind === 'skipped') {
    return result;
  }

  await options.transport.sendCard(
    options.target,
    buildFeishuInterruptCardPayload(buildCardContext(options.conversationId, options.target)),
  );
  return result;
}

export async function presentFeishuBusyNotice(options: {
  dispatchId: string;
  target: FeishuPresentationTarget;
  transport: FeishuPresentationTransport;
}): Promise<FeishuPresentationResult> {
  const result = markDispatchMessage(options.dispatchId, 'busy');
  if (result.kind === 'skipped') {
    return result;
  }

  await options.transport.sendText(options.target, 'Conversation is already running.');
  return result;
}

export async function presentFeishuFinalOutput(options: {
  dispatchId: string;
  output: string;
  target: FeishuPresentationTarget;
  transport: FeishuPresentationTransport;
}): Promise<FeishuPresentationResult> {
  const result = markDispatchMessage(options.dispatchId, 'final-output');
  if (result.kind === 'skipped') {
    return result;
  }

  await options.transport.sendText(options.target, options.output);
  return result;
}

export async function presentFeishuErrorOutput(options: {
  dispatchId: string;
  error: string;
  target: FeishuPresentationTarget;
  transport: FeishuPresentationTransport;
}): Promise<FeishuPresentationResult> {
  const result = markDispatchMessage(options.dispatchId, 'error-output');
  if (result.kind === 'skipped') {
    return result;
  }

  await options.transport.sendText(options.target, options.error);
  return result;
}
