import { randomUUID } from 'node:crypto';
import { beginFeishuDispatch } from './launch-state.js';
import {
  presentFeishuBusyNotice,
  presentFeishuErrorOutput,
  presentFeishuFinalOutput,
  presentFeishuInterruptCard,
} from './presentation.js';
import {
  runFeishuConversation,
  type FeishuRuntimeTransport,
  type FeishuTarget,
} from './runtime.js';

export async function runFeishuSessionFlow(options: {
  conversationId: string;
  target: FeishuTarget;
  prompt: string;
  mode: 'code' | 'ask';
  transport: FeishuRuntimeTransport;
  defaultCwd: string;
  sourceMessageId?: string;
  attachments?: Parameters<typeof runFeishuConversation>[0]['attachments'];
  attachmentFetchImpl?: Parameters<typeof runFeishuConversation>[0]['attachmentFetchImpl'];
  persistState?: () => Promise<void>;
}): Promise<{ kind: 'blocked' | 'started' | 'busy' | 'error' }> {
  const dispatch = options.sourceMessageId
    ? beginFeishuDispatch(options.sourceMessageId)
    : { dispatchId: randomUUID() };

  await presentFeishuInterruptCard({
    dispatchId: dispatch.dispatchId,
    conversationId: options.conversationId,
    target: options.target,
    transport: options.transport,
  });

  const result = await runFeishuConversation({
    conversationId: options.conversationId,
    target: options.target,
    prompt: options.prompt,
    mode: options.mode,
    transport: options.transport,
    defaultCwd: options.defaultCwd,
    sourceMessageId: options.sourceMessageId,
    attachments: options.attachments,
    attachmentFetchImpl: options.attachmentFetchImpl,
    persistState: options.persistState,
    lifecycle: {
      onFinalOutput: async (output) => {
        await presentFeishuFinalOutput({
          dispatchId: dispatch.dispatchId,
          output,
          target: options.target,
          transport: options.transport,
        });
      },
      onError: async (error) => {
        await presentFeishuErrorOutput({
          dispatchId: dispatch.dispatchId,
          error,
          target: options.target,
          transport: options.transport,
        });
      },
    },
  });

  if (result.kind === 'busy') {
    await presentFeishuBusyNotice({
      dispatchId: dispatch.dispatchId,
      target: options.target,
      transport: options.transport,
    });
  }

  return result;
}
