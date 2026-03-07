import type { GatewayToClientCommand, RemoteAttachmentLike } from '@agent-im-relay/core';
import type { FeishuTarget } from './runtime.js';

export type GatewayClientRecord = {
  clientId: string;
  connectedAt: number;
  lastSeenAt: number;
  queue: GatewayToClientCommand[];
};

export type GatewayPendingRequest = {
  requestId: string;
  clientId: string;
  conversationId: string;
  target: FeishuTarget;
  command: GatewayToClientCommand;
};

export type GatewayPendingSetup = {
  clientId: string;
  conversationId: string;
  target: FeishuTarget;
  prompt: string;
  mode: 'code' | 'ask';
  sourceMessageId?: string;
  attachments?: RemoteAttachmentLike[];
};

export type GatewayStateStore = ReturnType<typeof createGatewayStateStore>;

export function createGatewayStateStore(options: {
  defaultClientId?: string;
  now?: () => number;
  staleAfterMs?: number;
} = {}) {
  const now = options.now ?? Date.now;
  const staleAfterMs = options.staleAfterMs ?? 30_000;
  const clients = new Map<string, GatewayClientRecord>();
  const conversationRoutes = new Map<string, string>();
  const pendingRequests = new Map<string, GatewayPendingRequest>();
  const pendingSetups = new Map<string, GatewayPendingSetup>();
  const pendingAttachments = new Map<string, RemoteAttachmentLike[]>();
  let activeClientId = options.defaultClientId;

  function removeClient(clientId: string): void {
    clients.delete(clientId);
    if (activeClientId === clientId) {
      activeClientId = undefined;
    }
    for (const [conversationId, routedClientId] of conversationRoutes) {
      if (routedClientId === clientId) {
        conversationRoutes.delete(conversationId);
      }
    }
  }

  function ensureClient(clientId: string, touch = true): GatewayClientRecord | undefined {
    const record = clients.get(clientId);
    if (!record) {
      return undefined;
    }

    if (now() - record.lastSeenAt > staleAfterMs) {
      removeClient(clientId);
      return undefined;
    }

    if (touch) {
      record.lastSeenAt = now();
    }
    return record;
  }

  return {
    registerClient(clientId: string): GatewayClientRecord {
      const timestamp = now();
      const existing = clients.get(clientId);
      const record: GatewayClientRecord = existing
        ? {
          ...existing,
          connectedAt: existing.connectedAt,
          lastSeenAt: timestamp,
        }
        : {
          clientId,
          connectedAt: timestamp,
          lastSeenAt: timestamp,
          queue: [],
        };
      clients.set(clientId, record);
      activeClientId = clientId;
      return record;
    },

    touchClient(clientId: string): GatewayClientRecord | undefined {
      return ensureClient(clientId);
    },

    getClient(clientId: string): GatewayClientRecord | undefined {
      return clients.get(clientId);
    },

    getActiveClientId(): string | undefined {
      return activeClientId;
    },

    bindConversation(conversationId: string, clientId: string): void {
      conversationRoutes.set(conversationId, clientId);
    },

    resolveClientId(conversationId: string): string | undefined {
      const routedClientId = conversationRoutes.get(conversationId);
      if (routedClientId) {
        const routedClient = ensureClient(routedClientId, false);
        if (routedClient) {
          return routedClient.clientId;
        }
      }

      if (!activeClientId) {
        return undefined;
      }

      const activeClient = ensureClient(activeClientId, false);
      return activeClient?.clientId;
    },

    queueCommand(clientId: string, command: GatewayToClientCommand): boolean {
      const record = ensureClient(clientId);
      if (!record) {
        return false;
      }

      record.queue.push(command);
      return true;
    },

    drainCommands(clientId: string, limit = 1): GatewayToClientCommand[] {
      const record = ensureClient(clientId);
      if (!record || limit <= 0) {
        return [];
      }

      return record.queue.splice(0, limit);
    },

    storePendingRequest(request: GatewayPendingRequest): void {
      pendingRequests.set(request.requestId, request);
    },

    getPendingRequest(requestId: string): GatewayPendingRequest | undefined {
      return pendingRequests.get(requestId);
    },

    clearPendingRequest(requestId: string): void {
      pendingRequests.delete(requestId);
    },

    storePendingSetup(setup: GatewayPendingSetup): void {
      pendingSetups.set(setup.conversationId, setup);
    },

    getPendingSetup(conversationId: string): GatewayPendingSetup | undefined {
      return pendingSetups.get(conversationId);
    },

    clearPendingSetup(conversationId: string): void {
      pendingSetups.delete(conversationId);
    },

    queueAttachments(conversationId: string, attachments: RemoteAttachmentLike[]): void {
      if (attachments.length === 0) {
        return;
      }

      const current = pendingAttachments.get(conversationId) ?? [];
      pendingAttachments.set(conversationId, [...current, ...attachments]);
    },

    takeAttachments(conversationId: string): RemoteAttachmentLike[] {
      const attachments = pendingAttachments.get(conversationId) ?? [];
      pendingAttachments.delete(conversationId);
      return attachments;
    },
  };
}
