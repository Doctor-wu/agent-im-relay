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

export interface SessionAnchorAction {
  type: 'control-panel' | 'interrupt';
}

export interface SessionAnchorCard {
  type: 'session-anchor';
  conversationId: string;
  actions: SessionAnchorAction[];
  backend?: string;
  model?: string;
  effort?: string;
  status?: 'idle' | 'running';
}

export interface SessionControlAction {
  type: 'done' | 'backend' | 'model' | 'effort';
}

export interface SessionControlCard {
  type: 'session-controls';
  conversationId: string;
  actions: SessionControlAction[];
  backends: BackendName[];
}

export interface FeishuCardContext {
  conversationId: string;
  chatId: string;
  replyToMessageId?: string;
  prompt?: string;
  mode?: AgentMode;
}

export const FEISHU_NON_SESSION_CONTROL_TEXT = 'This chat is not an agent session. Create or open a session chat first.';

export function buildSessionAnchorCard(
  conversationId: string,
  summary: {
    backend?: string;
    model?: string;
    effort?: string;
    status?: 'idle' | 'running';
  } = {},
): SessionAnchorCard {
  return {
    type: 'session-anchor',
    conversationId,
    actions: [
      { type: 'control-panel' },
      { type: 'interrupt' },
    ],
    backend: summary.backend,
    model: summary.model,
    effort: summary.effort,
    status: summary.status,
  };
}

export function createBackendSelectionCard(
  conversationId: string,
  prompt: string,
  backends: BackendName[] = ['claude', 'codex'],
): BackendSelectionCard {
  return {
    type: 'backend-selection',
    conversationId,
    prompt,
    backends,
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

export function buildSessionControlCard(
  conversationId: string,
  backends: BackendName[] = ['claude', 'codex'],
): SessionControlCard {
  return {
    type: 'session-controls',
    conversationId,
    actions: [
      { type: 'done' },
      { type: 'backend' },
      { type: 'model' },
      { type: 'effort' },
    ],
    backends,
  };
}

function backendLabel(backend: BackendName): string {
  if (backend === 'claude') return 'Claude';
  if (backend === 'codex') return 'Codex';
  if (backend === 'opencode') return 'OpenCode';
  return backend;
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

function button(
  text: string,
  context: FeishuCardContext,
  action: string,
  extra: Record<string, unknown> = {},
  type?: 'primary' | 'default',
): Record<string, unknown> {
  return {
    tag: 'button',
    text: plainText(text),
    ...(type ? { type } : {}),
    value: actionValue(context, action, extra),
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
        ...card.backends.map((backend) => button(
          backendLabel(backend),
          context,
          'backend',
          { value: backend },
          backend === 'claude' ? 'primary' : 'default',
        )),
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
        button('Confirm', context, 'confirm-backend', { value: card.requestedBackend }, 'primary'),
        button('Cancel', context, 'cancel-backend'),
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
        button('Done', context, 'done'),
        ...card.backends.map(backend => button(backendLabel(backend), context, 'backend', { value: backend })),
        button('Claude 3.7', context, 'model', { value: 'claude-3-7-sonnet' }),
        button('GPT-5 Codex', context, 'model', { value: 'gpt-5-codex' }),
        button('Low', context, 'effort', { value: 'low' }),
        button('Medium', context, 'effort', { value: 'medium' }),
        button('High', context, 'effort', { value: 'high' }),
      ],
    },
  };
}

export function buildFeishuSessionControlPanelPayload(
  conversationId: string,
  context: FeishuCardContext,
  backends: BackendName[] = ['claude', 'codex'],
): Record<string, unknown> {
  return buildFeishuSessionControlCardPayload(
    buildSessionControlCard(conversationId, backends),
    context,
  );
}

export function buildFeishuInterruptCardPayload(
  context: FeishuCardContext,
): Record<string, unknown> {
  return {
    schema: '2.0',
    header: {
      title: plainText('Session Run'),
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: 'Stop the current run before sending a correction or a new direction.',
        },
        button('Interrupt', context, 'interrupt', {}, 'primary'),
      ],
    },
  };
}

export function buildFeishuSessionAnchorCardPayload(
  card: SessionAnchorCard,
  context: FeishuCardContext,
): Record<string, unknown> {
  const summary = [
    `Status: ${card.status ?? 'idle'}`,
    card.backend ? `Backend: ${card.backend}` : undefined,
    card.model ? `Model: ${card.model}` : undefined,
    card.effort ? `Effort: ${card.effort}` : undefined,
  ].filter(Boolean).join('\n');

  return {
    schema: '2.0',
    header: {
      title: plainText('Session'),
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: `Conversation \`${card.conversationId}\``,
        },
        {
          tag: 'markdown',
          content: 'Use the bot menu for session controls. This card is a fallback if the menu is unavailable.',
        },
        {
          tag: 'markdown',
          content: summary,
        },
        button('Fallback Controls', context, 'control-panel'),
        button('Interrupt', context, 'interrupt'),
      ],
    },
  };
}
