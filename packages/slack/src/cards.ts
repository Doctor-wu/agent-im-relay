import type { BackendModel, BackendName } from '@agent-im-relay/core';

export type SlackBlock = Record<string, unknown>;

export interface SlackBackendSelectionCard {
  conversationId: string;
  prompt: string;
  backends: BackendName[];
}

export interface SlackModelSelectionCard {
  conversationId: string;
  backend: BackendName;
  models: BackendModel[];
}

export interface SlackPermissionCard {
  conversationId: string;
  requestId: string;
  tool?: string;
  reason?: string;
}

function backendLabel(backend: BackendName): string {
  if (backend === 'claude') return 'Claude';
  if (backend === 'codex') return 'Codex';
  if (backend === 'opencode') return 'OpenCode';
  return backend;
}

function actionValue(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

export function buildSlackBackendSelectionBlocks(card: SlackBackendSelectionCard): SlackBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Choose Backend*\n${card.prompt}`,
      },
    },
    {
      type: 'actions',
      elements: card.backends.map(backend => ({
        type: 'button',
        text: {
          type: 'plain_text',
          text: backendLabel(backend),
        },
        action_id: `backend:${backend}`,
        value: actionValue({
          type: 'backend',
          conversationId: card.conversationId,
          value: backend,
        }),
      })),
    },
  ];
}

export function buildSlackModelSelectionBlocks(card: SlackModelSelectionCard): SlackBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Choose Model*\nBackend: \`${card.backend}\``,
      },
    },
    {
      type: 'actions',
      elements: card.models.slice(0, 25).map(model => ({
        type: 'button',
        text: {
          type: 'plain_text',
          text: model.label,
        },
        action_id: `model:${model.id}`,
        value: actionValue({
          type: 'model',
          conversationId: card.conversationId,
          backend: card.backend,
          value: model.id,
        }),
      })),
    },
  ];
}

export function buildSlackPermissionBlocks(
  card: SlackPermissionCard,
  decision?: 'approved' | 'denied' | 'timeout',
): SlackBlock[] {
  const status = decision
    ? decision === 'approved'
      ? '*Status:* Approved'
      : decision === 'timeout'
        ? '*Status:* Timed out and denied'
        : '*Status:* Denied'
    : undefined;

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*Permission Required*',
          card.tool ? `*Tool:* \`${card.tool}\`` : undefined,
          card.reason,
          status,
        ].filter(Boolean).join('\n'),
      },
    },
    ...(decision
      ? []
      : [{
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Approve',
              },
              style: 'primary',
              action_id: `permission:${card.requestId}:approved`,
              value: actionValue({
                type: 'permission',
                conversationId: card.conversationId,
                requestId: card.requestId,
                decision: 'approved',
                tool: card.tool,
                reason: card.reason,
              }),
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Deny',
              },
              action_id: `permission:${card.requestId}:denied`,
              value: actionValue({
                type: 'permission',
                conversationId: card.conversationId,
                requestId: card.requestId,
                decision: 'denied',
                tool: card.tool,
                reason: card.reason,
              }),
            },
          ],
        }],
    ),
  ];
}
