import type { BackendName } from '@agent-im-relay/core';
import type { AgentMode } from '@agent-im-relay/core';

export interface BackendSelectionCard {
  type: 'backend-selection';
  conversationId: string;
  prompt: string;
  backends: BackendName[];
}

export interface BackendConfirmationCard {
  type: 'backend-confirmation';
  conversationId: string;
  currentBackend: BackendName;
  requestedBackend: BackendName;
}

export interface SessionControlAction {
  type: 'interrupt' | 'done' | 'backend' | 'model' | 'effort';
}

export interface SessionControlCard {
  type: 'session-controls';
  conversationId: string;
  actions: SessionControlAction[];
}

export interface FeishuCardContext {
  conversationId: string;
  chatId: string;
  replyToMessageId?: string;
  prompt?: string;
  mode?: AgentMode;
}

export function createBackendSelectionCard(conversationId: string, prompt: string): BackendSelectionCard {
  return {
    type: 'backend-selection',
    conversationId,
    prompt,
    backends: ['claude', 'codex'],
  };
}

export function createBackendConfirmationCard(
  conversationId: string,
  currentBackend: BackendName,
  requestedBackend: BackendName,
): BackendConfirmationCard {
  return {
    type: 'backend-confirmation',
    conversationId,
    currentBackend,
    requestedBackend,
  };
}

export function buildSessionControlCard(conversationId: string): SessionControlCard {
  return {
    type: 'session-controls',
    conversationId,
    actions: [
      { type: 'interrupt' },
      { type: 'done' },
      { type: 'backend' },
      { type: 'model' },
      { type: 'effort' },
    ],
  };
}

function actionValue(context: FeishuCardContext, action: string, extra: Record<string, unknown> = {}) {
  return {
    conversationId: context.conversationId,
    chatId: context.chatId,
    replyToMessageId: context.replyToMessageId,
    prompt: context.prompt,
    mode: context.mode,
    action,
    ...extra,
  };
}

function plainText(content: string): Record<string, unknown> {
  return {
    tag: 'plain_text',
    content,
  };
}

export function buildFeishuBackendSelectionCardPayload(
  card: BackendSelectionCard,
  context: FeishuCardContext,
): Record<string, unknown> {
  return {
    schema: '2.0',
    header: {
      title: plainText('Choose Backend'),
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: `Select a backend to start conversation \`${card.conversationId}\`.`,
        },
        {
          tag: 'markdown',
          content: card.prompt.slice(0, 500),
        },
        {
          tag: 'action',
          actions: card.backends.map((backend) => ({
            tag: 'button',
            text: plainText(backend),
            type: backend === 'claude' ? 'primary' : 'default',
            value: actionValue(context, 'backend', { value: backend }),
          })),
        },
      ],
    },
  };
}

export function buildFeishuBackendConfirmationCardPayload(
  card: BackendConfirmationCard,
  context: FeishuCardContext,
): Record<string, unknown> {
  return {
    schema: '2.0',
    header: {
      title: plainText('Confirm Backend Switch'),
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: `Switch backend from \`${card.currentBackend}\` to \`${card.requestedBackend}\`? This clears the current continuation.`,
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: plainText('Confirm'),
              type: 'primary',
              value: actionValue(context, 'confirm-backend', { value: card.requestedBackend }),
            },
            {
              tag: 'button',
              text: plainText('Cancel'),
              value: actionValue(context, 'cancel-backend'),
            },
          ],
        },
      ],
    },
  };
}

export function buildFeishuSessionControlCardPayload(
  card: SessionControlCard,
  context: FeishuCardContext,
): Record<string, unknown> {
  return {
    schema: '2.0',
    header: {
      title: plainText('Session Controls'),
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: `Conversation \`${card.conversationId}\``,
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: plainText('Interrupt'),
              value: actionValue(context, 'interrupt'),
            },
            {
              tag: 'button',
              text: plainText('Done'),
              value: actionValue(context, 'done'),
            },
            {
              tag: 'button',
              text: plainText('Claude'),
              value: actionValue(context, 'backend', { value: 'claude' }),
            },
            {
              tag: 'button',
              text: plainText('Codex'),
              value: actionValue(context, 'backend', { value: 'codex' }),
            },
          ],
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: plainText('Claude 3.7'),
              value: actionValue(context, 'model', { value: 'claude-3-7-sonnet' }),
            },
            {
              tag: 'button',
              text: plainText('GPT-5 Codex'),
              value: actionValue(context, 'model', { value: 'gpt-5-codex' }),
            },
          ],
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: plainText('Low'),
              value: actionValue(context, 'effort', { value: 'low' }),
            },
            {
              tag: 'button',
              text: plainText('Medium'),
              value: actionValue(context, 'effort', { value: 'medium' }),
            },
            {
              tag: 'button',
              text: plainText('High'),
              value: actionValue(context, 'effort', { value: 'high' }),
            },
          ],
        },
      ],
    },
  };
}
