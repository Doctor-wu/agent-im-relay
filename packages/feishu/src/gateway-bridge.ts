import { randomUUID } from 'node:crypto';
import type {
  ClientHeartbeatEvent,
  ClientHelloEvent,
  ClientToGatewayEvent,
  ConversationControlAction,
  ConversationControlCommand,
  ConversationRunCommand,
  GatewayToClientCommand,
  RemoteAttachmentLike,
} from '@agent-im-relay/core';
import type { FeishuTarget } from './runtime.js';
import type { GatewayStateStore } from './gateway-state.js';

export type GatewayBridgeResponseSink = {
  sendText(target: FeishuTarget, text: string): Promise<void>;
  sendCard(target: FeishuTarget, card: Record<string, unknown>): Promise<void>;
  sendFile(target: FeishuTarget, file: { fileName: string; data: string; mimeType?: string }): Promise<void>;
};

export type GatewayDispatchResult =
  | {
    kind: 'queued';
    clientId: string;
    requestId: string;
  }
  | {
    kind: 'offline';
    reason: 'client-offline';
  };

export type GatewayPendingSetupDispatchResult =
  | GatewayDispatchResult
  | {
    kind: 'missing';
    reason: 'setup-not-found';
  };

export function createGatewayBridge(options: {
  state: GatewayStateStore;
  sink: GatewayBridgeResponseSink;
  now?: () => string;
}) {
  const now = options.now ?? (() => new Date().toISOString());

  function queueCommand(command: GatewayToClientCommand, target: FeishuTarget): GatewayDispatchResult {
    const clientId = options.state.resolveClientId(command.conversationId ?? '');
    if (!clientId) {
      return {
        kind: 'offline',
        reason: 'client-offline',
      };
    }

    options.state.bindConversation(command.conversationId ?? '', clientId);
    options.state.storePendingRequest({
      requestId: command.requestId,
      clientId,
      conversationId: command.conversationId ?? '',
      target,
      command,
    });

    if (!options.state.queueCommand(clientId, command)) {
      options.state.clearPendingRequest(command.requestId);
      return {
        kind: 'offline',
        reason: 'client-offline',
      };
    }

    return {
      kind: 'queued',
      clientId,
      requestId: command.requestId,
    };
  }

  return {
    registerClient(event: ClientHelloEvent | ClientHeartbeatEvent) {
      return options.state.registerClient(event.clientId);
    },

    queueAttachments(conversationId: string, attachments: RemoteAttachmentLike[]): void {
      options.state.queueAttachments(conversationId, attachments);
    },

    takeQueuedAttachments(conversationId: string): RemoteAttachmentLike[] {
      return options.state.takeAttachments(conversationId);
    },

    dispatchRunCommand(input: {
      clientId?: string;
      conversationId: string;
      target: FeishuTarget;
      prompt: string;
      mode: 'code' | 'ask';
      sourceMessageId?: string;
      attachments?: RemoteAttachmentLike[];
    }): GatewayDispatchResult {
      const requestId = randomUUID();
      const clientId = input.clientId ?? options.state.resolveClientId(input.conversationId);
      if (!clientId) {
        return {
          kind: 'offline',
          reason: 'client-offline',
        };
      }

      const command: ConversationRunCommand = {
        type: 'conversation.run',
        clientId,
        requestId,
        conversationId: input.conversationId,
        timestamp: now(),
        payload: {
          target: input.target,
          prompt: input.prompt,
          mode: input.mode,
          sourceMessageId: input.sourceMessageId,
          attachments: [
            ...options.state.takeAttachments(input.conversationId),
            ...(input.attachments ?? []),
          ],
        },
      };

      return queueCommand(command, input.target);
    },

    dispatchControlCommand(input: {
      clientId?: string;
      conversationId: string;
      target: FeishuTarget;
      action: ConversationControlAction;
    }): GatewayDispatchResult {
      const requestId = randomUUID();
      const clientId = input.clientId ?? options.state.resolveClientId(input.conversationId);
      if (!clientId) {
        return {
          kind: 'offline',
          reason: 'client-offline',
        };
      }

      const command: ConversationControlCommand = {
        type: 'conversation.control',
        clientId,
        requestId,
        conversationId: input.conversationId,
        timestamp: now(),
        payload: {
          target: input.target,
          action: input.action,
        },
      };

      return queueCommand(command, input.target);
    },

    dispatchPendingRun(conversationId: string): GatewayPendingSetupDispatchResult {
      const pendingSetup = options.state.getPendingSetup(conversationId);
      if (!pendingSetup) {
        return {
          kind: 'missing',
          reason: 'setup-not-found',
        };
      }

      const result = this.dispatchRunCommand({
        clientId: pendingSetup.clientId,
        conversationId: pendingSetup.conversationId,
        target: pendingSetup.target,
        prompt: pendingSetup.prompt,
        mode: pendingSetup.mode,
        sourceMessageId: pendingSetup.sourceMessageId,
        attachments: pendingSetup.attachments,
      });

      if (result.kind === 'queued') {
        options.state.clearPendingSetup(conversationId);
      }

      return result;
    },

    pullCommands(clientId: string, limit = 1): GatewayToClientCommand[] {
      options.state.touchClient(clientId);
      return options.state.drainCommands(clientId, limit);
    },

    async consumeClientEvent(event: ClientToGatewayEvent): Promise<void> {
      if (event.type === 'client.hello' || event.type === 'client.heartbeat') {
        options.state.registerClient(event);
        return;
      }

      const pending = options.state.getPendingRequest(event.requestId);
      if (!pending) {
        return;
      }

      if (event.type === 'conversation.text') {
        await options.sink.sendText(pending.target, event.payload.text);
        return;
      }

      if (event.type === 'conversation.card') {
        await options.sink.sendCard(pending.target, event.payload.card);
        return;
      }

      if (event.type === 'conversation.file') {
        await options.sink.sendFile(pending.target, event.payload);
        return;
      }

      if (event.type === 'conversation.error') {
        await options.sink.sendText(pending.target, `Relay error: ${event.payload.error}`);
        options.state.clearPendingRequest(event.requestId);
        return;
      }

      if (event.type === 'conversation.done') {
        if (pending.command.type === 'conversation.run') {
          if (event.payload.status === 'blocked') {
            options.state.storePendingSetup({
              clientId: pending.clientId,
              conversationId: pending.conversationId,
              target: pending.target,
              prompt: pending.command.payload.prompt,
              mode: pending.command.payload.mode,
              sourceMessageId: pending.command.payload.sourceMessageId,
              attachments: pending.command.payload.attachments,
            });
          } else {
            options.state.clearPendingSetup(pending.conversationId);
          }
        }

        if (event.payload.resultText) {
          await options.sink.sendText(pending.target, event.payload.resultText);
        }
        options.state.clearPendingRequest(event.requestId);
      }
    },
  };
}
