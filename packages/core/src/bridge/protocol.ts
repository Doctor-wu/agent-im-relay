import type { AgentMode } from '../agent/tools.js';
import type { ConversationControlAction } from '../platform/conversation.js';
import type { RemoteAttachmentLike } from '../runtime/files.js';

type BridgeEnvelopeBase = {
  clientId: string;
  requestId: string;
  conversationId?: string;
  timestamp: string;
};

export type ManagedBridgeTarget = {
  chatId: string;
  replyToMessageId?: string;
};

export type ConversationRunCommand = BridgeEnvelopeBase & {
  type: 'conversation.run';
  conversationId: string;
  payload: {
    target: ManagedBridgeTarget;
    prompt: string;
    mode: AgentMode;
    sourceMessageId?: string;
    attachments?: RemoteAttachmentLike[];
  };
};

export type ConversationControlCommand = BridgeEnvelopeBase & {
  type: 'conversation.control';
  conversationId: string;
  payload: {
    target: ManagedBridgeTarget;
    action: ConversationControlAction;
  };
};

export type ConversationFileCommand = BridgeEnvelopeBase & {
  type: 'conversation.file';
  conversationId: string;
  payload: {
    target: ManagedBridgeTarget;
    attachments: RemoteAttachmentLike[];
    sourceMessageId?: string;
  };
};

export type ClientAckCommand = BridgeEnvelopeBase & {
  type: 'client.ack';
  payload: {
    acknowledgedRequestId: string;
  };
};

export type GatewayToClientCommand =
  | ConversationRunCommand
  | ConversationControlCommand
  | ConversationFileCommand
  | ClientAckCommand;

export type ClientHelloEvent = BridgeEnvelopeBase & {
  type: 'client.hello';
  payload: {
    token: string;
  };
};

export type ClientHeartbeatEvent = BridgeEnvelopeBase & {
  type: 'client.heartbeat';
  payload: {
    token: string;
  };
};

export type ConversationTextEvent = BridgeEnvelopeBase & {
  type: 'conversation.text';
  conversationId: string;
  payload: {
    text: string;
  };
};

export type ConversationCardEvent = BridgeEnvelopeBase & {
  type: 'conversation.card';
  conversationId: string;
  payload: {
    card: Record<string, unknown>;
  };
};

export type ConversationFileEvent = BridgeEnvelopeBase & {
  type: 'conversation.file';
  conversationId: string;
  payload: {
    fileName: string;
    data: string;
    mimeType?: string;
  };
};

export type ConversationErrorEvent = BridgeEnvelopeBase & {
  type: 'conversation.error';
  conversationId: string;
  payload: {
    error: string;
  };
};

export type ConversationDoneEvent = BridgeEnvelopeBase & {
  type: 'conversation.done';
  conversationId: string;
  payload: {
    status: 'blocked' | 'started' | 'busy' | 'completed' | 'failed';
    resultText?: string;
  };
};

export type ClientToGatewayEvent =
  | ClientHelloEvent
  | ClientHeartbeatEvent
  | ConversationTextEvent
  | ConversationCardEvent
  | ConversationFileEvent
  | ConversationErrorEvent
  | ConversationDoneEvent;
