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
