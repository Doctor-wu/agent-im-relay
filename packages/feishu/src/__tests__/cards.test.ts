import { describe, expect, it } from 'vitest';
import {
  FEISHU_NON_SESSION_CONTROL_TEXT,
  buildFeishuModelSelectionCardPayload,
  buildFeishuSessionAnchorCardPayload,
  buildFeishuBackendConfirmationCardPayload,
  buildFeishuBackendSelectionCardPayload,
  buildFeishuInterruptCardPayload,
  buildFeishuSessionControlPanelPayload,
  buildFeishuSessionControlCardPayload,
  buildModelSelectionCard,
  buildSessionAnchorCard,
  buildSessionControlCard,
  createBackendConfirmationCard,
  createBackendSelectionCard,
} from '../cards.js';

const context = {
  conversationId: 'session-chat-1',
  chatId: 'session-chat-1',
  replyToMessageId: 'message-1',
} as const;

function collectElementTags(payload: Record<string, any>): string[] {
  const tags: string[] = [];

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (!value || typeof value !== 'object') {
      return;
    }

    const record = value as Record<string, unknown>;
    if (typeof record.tag === 'string') {
      tags.push(record.tag);
    }

    Object.values(record).forEach(visit);
  }

  visit(payload);
  return tags;
}

function collectButtonTexts(payload: Record<string, any>): string[] {
  return payload.body.elements
    .filter((element: Record<string, unknown>) => element.tag === 'button')
    .map((button: Record<string, any>) => button.text.content);
}

describe('Feishu cards', () => {
  it('does not use deprecated action blocks in schema v2 payloads', () => {
    const backendSelection = buildFeishuBackendSelectionCardPayload(
      createBackendSelectionCard('session-chat-1', 'hello bot'),
      context,
    );
    const backendConfirmation = buildFeishuBackendConfirmationCardPayload(
      createBackendConfirmationCard('session-chat-1', 'claude', 'codex'),
      context,
    );
    const sessionControls = buildFeishuSessionControlCardPayload(
      buildSessionControlCard('session-chat-1'),
      context,
    );

    expect(collectElementTags(backendSelection)).not.toContain('action');
    expect(collectElementTags(backendConfirmation)).not.toContain('action');
    expect(collectElementTags(sessionControls)).not.toContain('action');
  });

  it('renders the anchor card with only control-panel and interrupt actions', () => {
    const anchor = buildFeishuSessionAnchorCardPayload(
      buildSessionAnchorCard('session-chat-1'),
      context,
    );

    expect(anchor.body.elements).toContainEqual({
      tag: 'markdown',
      content: 'Use the bot menu for session controls. This card is a fallback if the menu is unavailable.',
    });
    expect(collectButtonTexts(anchor)).toEqual(['Fallback Controls', 'Interrupt']);
  });

  it('keeps the expanded control panel actions separate from the anchor card', () => {
    const panel = buildFeishuSessionControlCardPayload(
      buildSessionControlCard('session-chat-1', ['claude', 'codex'], [
        { id: 'sonnet', label: 'Sonnet' },
        { id: 'opus', label: 'Opus' },
      ]),
      context,
    );

    expect(collectButtonTexts(panel)).toEqual([
      'Done',
      'Claude',
      'Codex',
      'Sonnet',
      'Opus',
      'Low',
      'Medium',
      'High',
    ]);
    expect(collectButtonTexts(panel)).not.toContain('Control');
    expect(collectButtonTexts(panel)).not.toContain('Interrupt');
  });

  it('builds the expanded control panel through one shared payload helper', () => {
    expect(buildFeishuSessionControlPanelPayload('session-chat-1', context)).toEqual(
      buildFeishuSessionControlCardPayload(
        buildSessionControlCard('session-chat-1'),
        context,
      ),
    );
  });

  it('builds a dedicated interrupt card for message-scoped controls', () => {
    const interrupt = buildFeishuInterruptCardPayload(context);

    expect(interrupt.header).toEqual({
      title: {
        tag: 'plain_text',
        content: 'Session Run',
      },
    });
    expect(collectButtonTexts(interrupt)).toEqual(['Interrupt']);
    expect(interrupt.body.elements).toContainEqual({
      tag: 'markdown',
      content: 'Stop the current run before sending a correction or a new direction.',
    });
  });

  it('renders a model selection card from backend-owned model capabilities', () => {
    const payload = buildFeishuModelSelectionCardPayload(
      buildModelSelectionCard('session-chat-1', 'claude', [
        { id: 'sonnet', label: 'Sonnet' },
        { id: 'opus', label: 'Opus' },
      ]),
      context,
    );

    expect(collectButtonTexts(payload)).toEqual(['Sonnet', 'Opus']);
  });

  it('exposes explanatory copy for non-session control requests', () => {
    expect(FEISHU_NON_SESSION_CONTROL_TEXT).toBe('This chat is not an agent session. Create or open a session chat first.');
  });
});
