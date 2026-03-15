import { App } from '@slack/bolt';
import { fileURLToPath } from 'node:url';
import {
  applySessionControlCommand,
  conversationBackend,
  conversationMode,
  conversationModels,
  evaluateConversationRunRequest,
  getAvailableBackendCapabilities,
  getAvailableBackendNames,
  listSkills,
  maybeUnrefTimer,
  resolvePermissionRequest,
  resolveBackendModelId,
  runPlatformConversation,
  type AgentStreamEvent,
  type BackendModel,
  type BackendName,
  type AgentMode,
} from '@agent-im-relay/core';
import {
  buildSlackBackendSelectionBlocks,
  buildSlackModelSelectionBlocks,
  buildSlackPermissionBlocks,
  type SlackBlock,
} from './cards';
import { parseSlackAskCommand } from './commands/ask';
import { parseSlackCodeCommand } from './commands/code';
import { resolveSlackDoneTarget } from './commands/done';
import { resolveSlackInterruptTarget } from './commands/interrupt';
import { parseSlackSkillCommand } from './commands/skill';
import {
  buildSlackConversationId,
  isSlackDirectMessage,
  resolveSlackConversationIdForMessage,
  shouldProcessSlackMessage,
  type SlackMessageEvent,
} from './conversation';
import { readSlackConfig, type SlackConfig } from './config';
import { applySlackReaction, type SlackReactionPhase, type SlackReactionTarget } from './presentation';
import {
  findSlackConversationByThreadTs,
  rememberSlackConversation,
  type SlackConversationRecord,
} from './state';
import { streamSlackMessages } from './stream';

export interface SlackCommandPayload {
  command: '/code' | '/ask' | '/interrupt' | '/done' | '/skill';
  text: string;
  channel_id: string;
  thread_ts?: string;
  user_id: string;
  user_name?: string;
  trigger_id: string;
  command_ts: string;
}

export interface SlackActionPayload {
  channel: { id: string };
  message: { ts: string; thread_ts?: string };
  actions: Array<{ action_id?: string; value?: string }>;
  user: { id: string };
}

export interface SlackAppLike {
  command(name: string, handler: (args: any) => Promise<void>): unknown;
  action(constraint: string | RegExp, handler: (args: any) => Promise<void>): unknown;
  event(name: string, handler: (args: any) => Promise<void>): unknown;
  start(): Promise<void>;
}

export interface SlackRuntimeTransport {
  createThread(args: { channelId: string; authorName: string; prompt: string }): Promise<{
    channelId: string;
    threadTs: string;
    rootMessageTs: string;
  }>;
  sendMessage(payload: { channelId: string; threadTs?: string; text: string; blocks?: unknown }): Promise<{ ts: string }>;
  updateMessage(payload: { channelId: string; ts: string; text: string; blocks?: unknown }): Promise<void>;
  addReaction?(reaction: string, target: SlackReactionTarget): Promise<void>;
  removeReaction?(reaction: string, target: SlackReactionTarget): Promise<void>;
  showSelectMenu(payload: {
    conversationId: string;
    channelId: string;
    threadTs: string;
    placeholder: string;
    options: Array<{ label: string; value: string; description?: string }>;
  }): Promise<void>;
  sendText(target: { channelId: string; threadTs?: string }, text: string): Promise<void>;
  sendBlocks(target: { channelId: string; threadTs?: string }, text: string, blocks: SlackBlock[]): Promise<string | undefined>;
  updateBlocks(target: { channelId: string; threadTs?: string }, messageTs: string, text: string, blocks: SlackBlock[]): Promise<void>;
  sendCommandResponse(command: SlackCommandPayload, text: string): Promise<void>;
}

export interface SlackRuntimeOptions {
  config?: SlackConfig;
  transport: SlackRuntimeTransport;
  defaultCwd: string;
  modelSelectionTimeoutMs?: number;
  createApp?: (config: SlackConfig) => SlackAppLike;
}

export interface SlackRuntime {
  start(): Promise<void>;
  handleCommand(command: SlackCommandPayload): Promise<unknown>;
  handleAction(action: SlackActionPayload): Promise<unknown>;
  handleMessage(message: SlackMessageEvent): Promise<unknown>;
}

type SlackPendingRun = {
  conversationId: string;
  target: { channelId: string; threadTs: string };
  prompt: string;
  mode: AgentMode;
  source?: 'slash-command' | 'app_mention' | 'dm-message' | 'thread-message';
  sourceMessageId?: string;
  cardMessageTs?: string;
  backend?: BackendName;
};

// TODO(slack): persist pending runs via resolveSlackPendingRunStateFile once restart-resume is required.
const pendingRuns = new Map<string, SlackPendingRun>();
const pendingModelTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingPermissions = new Map<string, {
  target: { channelId: string; threadTs: string };
  messageTs: string;
  tool?: string;
  reason?: string;
}>();

function hasReactionTransport(
  transport: SlackRuntimeTransport,
): transport is SlackRuntimeTransport & Required<Pick<SlackRuntimeTransport, 'addReaction' | 'removeReaction'>> {
  return typeof transport.addReaction === 'function' && typeof transport.removeReaction === 'function';
}
function clearPendingTimer(conversationId: string): void {
  const timer = pendingModelTimers.get(conversationId);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  pendingModelTimers.delete(conversationId);
}

function resetPendingRun(conversationId: string): void {
  clearPendingTimer(conversationId);
  pendingRuns.delete(conversationId);
}

function permissionKey(conversationId: string, requestId: string): string {
  return `${conversationId}:${requestId}`;
}

function buildRuntimeConversationRecord(created: {
  channelId: string;
  threadTs: string;
  rootMessageTs: string;
  containerType?: 'channel-thread' | 'dm';
}): SlackConversationRecord {
  const conversationId = buildSlackConversationId(created.threadTs);
  return {
    conversationId,
    channelId: created.channelId,
    threadTs: created.threadTs,
    rootMessageTs: created.rootMessageTs,
    containerType: created.containerType,
  };
}

function normalizeSlackPrompt(text: string | undefined): string {
  return (text ?? '').replace(/<@[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function resolveReactionTarget(pendingRun: SlackPendingRun): SlackReactionTarget | undefined {
  if (!pendingRun.sourceMessageId) {
    return undefined;
  }

  return {
    channelId: pendingRun.target.channelId,
    messageTs: pendingRun.sourceMessageId,
  };
}

function mapConversationPhaseToReaction(phase: 'thinking' | 'tools' | 'done' | 'error'): SlackReactionPhase {
  if (phase === 'tools') {
    return 'tool_running';
  }

  return phase;
}

async function maybeMarkSlackMessageReceived(
  transport: SlackRuntimeTransport,
  target: SlackReactionTarget | undefined,
): Promise<void> {
  if (!target || !hasReactionTransport(transport)) {
    return;
  }

  await applySlackReaction(transport, target, 'received');
}

function buildRootConversationRecord(message: SlackMessageEvent, containerType: 'channel-thread' | 'dm'): SlackConversationRecord {
  return buildRuntimeConversationRecord({
    channelId: message.channel,
    threadTs: message.ts,
    rootMessageTs: message.ts,
    containerType,
  });
}

function parseActionValue(action: SlackActionPayload['actions'][number]): Record<string, unknown> | null {
  if (!action.value) {
    return null;
  }

  try {
    const parsed = JSON.parse(action.value) as Record<string, unknown>;
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function createDefaultApp(config: SlackConfig): SlackAppLike {
  return new App({
    token: config.slackBotToken,
    signingSecret: config.slackSigningSecret,
    socketMode: config.slackSocketMode,
    appToken: config.slackAppToken,
  }) as unknown as SlackAppLike;
}

export function createSlackBoltTransport(app: App): SlackRuntimeTransport {
  return {
    async createThread({ channelId, authorName, prompt }) {
      const result = await app.client.chat.postMessage({
        channel: channelId,
        text: `*${authorName}:* ${prompt}`,
      });
      const ts = result.ts;
      if (!ts) {
        throw new Error('Slack did not return a root message ts when creating a thread.');
      }

      return {
        channelId,
        threadTs: ts,
        rootMessageTs: ts,
      };
    },
    async sendMessage({ channelId, threadTs, text, blocks }) {
      const result = await app.client.chat.postMessage({
        channel: channelId,
        text,
        ...(threadTs ? { thread_ts: threadTs } : {}),
        ...(Array.isArray(blocks) ? { blocks: blocks as any[] } : {}),
      });
      if (!result.ts) {
        throw new Error('Slack did not return a message ts.');
      }

      return { ts: result.ts };
    },
    async updateMessage({ channelId, ts, text, blocks }) {
      await app.client.chat.update({
        channel: channelId,
        ts,
        text,
        ...(Array.isArray(blocks) ? { blocks: blocks as any[] } : {}),
      });
    },
    async addReaction(reaction, target) {
      await app.client.reactions.add({
        channel: target.channelId,
        timestamp: target.messageTs,
        name: reaction,
      });
    },
    async removeReaction(reaction, target) {
      await app.client.reactions.remove({
        channel: target.channelId,
        timestamp: target.messageTs,
        name: reaction,
      });
    },
    async showSelectMenu({ channelId, threadTs, placeholder, options, conversationId }) {
      await app.client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: placeholder,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: placeholder,
            },
          },
          {
            type: 'actions',
            elements: options.slice(0, 25).map(option => ({
              type: 'button',
              text: {
                type: 'plain_text',
                text: option.label,
              },
              action_id: `select:${option.value}`,
              value: JSON.stringify({
                type: 'select',
                conversationId,
                value: option.value,
              }),
            })),
          },
        ],
      });
    },
    async sendText(target, text) {
      await app.client.chat.postMessage({
        channel: target.channelId,
        text,
        ...(target.threadTs ? { thread_ts: target.threadTs } : {}),
      });
    },
    async sendBlocks(target, text, blocks) {
      const result = await app.client.chat.postMessage({
        channel: target.channelId,
        text,
        ...(target.threadTs ? { thread_ts: target.threadTs } : {}),
        blocks: blocks as any[],
      });
      return result.ts ?? undefined;
    },
    async updateBlocks(target, messageTs, text, blocks) {
      await app.client.chat.update({
        channel: target.channelId,
        ts: messageTs,
        text,
        blocks: blocks as any[],
      });
    },
    async sendCommandResponse(command, text) {
      await app.client.chat.postMessage({
        channel: command.channel_id,
        text,
        ...(command.thread_ts ? { thread_ts: command.thread_ts } : {}),
      });
    },
  };
}

async function resolveModelSelection(conversationId: string, backend: BackendName | undefined): Promise<{
  backend: BackendName | undefined;
  models: BackendModel[];
  normalizedModel: string | undefined;
  requiresSelection: boolean;
}> {
  if (!backend) {
    return {
      backend,
      models: [],
      normalizedModel: undefined,
      requiresSelection: false,
    };
  }

  const capabilities = await getAvailableBackendCapabilities();
  const models = capabilities.find(capability => capability.name === backend)?.models ?? [];
  const selectedModel = conversationModels.get(conversationId);
  const normalizedModel = selectedModel
    ? resolveBackendModelId(backend, selectedModel)
    : undefined;

  if (selectedModel && normalizedModel && normalizedModel !== selectedModel) {
    conversationModels.set(conversationId, normalizedModel);
  }

  return {
    backend,
    models,
    normalizedModel,
    requiresSelection: models.length > 0 && !normalizedModel,
  };
}

async function publishBlocks(
  transport: SlackRuntimeTransport,
  pendingRun: SlackPendingRun,
  text: string,
  blocks: SlackBlock[],
): Promise<void> {
  if (pendingRun.cardMessageTs) {
    await transport.updateBlocks(pendingRun.target, pendingRun.cardMessageTs, text, blocks);
    return;
  }

  pendingRun.cardMessageTs = await transport.sendBlocks(pendingRun.target, text, blocks) ?? pendingRun.cardMessageTs;
}

async function publishPermissionRequest(
  transport: SlackRuntimeTransport,
  pendingRun: SlackPendingRun,
  event: Extract<AgentStreamEvent, { type: 'permission-requested' }>,
): Promise<void> {
  const messageTs = await transport.sendBlocks(
    pendingRun.target,
    'Permission Required',
    buildSlackPermissionBlocks({
      conversationId: pendingRun.conversationId,
      requestId: event.requestId,
      tool: event.tool,
      reason: event.reason,
    }),
  );

  if (messageTs) {
    pendingPermissions.set(permissionKey(pendingRun.conversationId, event.requestId), {
      target: pendingRun.target,
      messageTs,
      tool: event.tool,
      reason: event.reason,
    });
  }
}

async function updatePermissionState(
  transport: SlackRuntimeTransport,
  conversationId: string,
  requestId: string,
  decision: 'approved' | 'denied' | 'timeout',
): Promise<void> {
  const key = permissionKey(conversationId, requestId);
  const pending = pendingPermissions.get(key);
  if (!pending) {
    return;
  }

  await transport.updateBlocks(
    pending.target,
    pending.messageTs,
    'Permission Required',
    buildSlackPermissionBlocks({
      conversationId,
      requestId,
      tool: pending.tool,
      reason: pending.reason,
    }, decision),
  );
  pendingPermissions.delete(key);
}

async function continuePendingRun(
  options: SlackRuntimeOptions,
  pendingRun: SlackPendingRun,
): Promise<
  | { kind: 'blocked'; conversationId: string; reason: 'backend-selection' | 'model-selection' }
  | { kind: 'started'; conversationId: string; mode?: AgentMode }
  | { kind: 'busy'; conversationId: string }
> {
  const evaluation = evaluateConversationRunRequest({
    conversationId: pendingRun.conversationId,
    requireBackendSelection: true,
  });

  if (evaluation.kind === 'setup-required') {
    const backends = await getAvailableBackendNames();
    if (backends.length === 0) {
      await options.transport.sendText(pendingRun.target, 'No available backends detected.');
      resetPendingRun(pendingRun.conversationId);
      return {
        kind: 'busy',
        conversationId: pendingRun.conversationId,
      };
    }

    pendingRuns.set(pendingRun.conversationId, pendingRun);
    await publishBlocks(
      options.transport,
      pendingRun,
      'Choose Backend',
      buildSlackBackendSelectionBlocks({
        conversationId: pendingRun.conversationId,
        prompt: pendingRun.prompt,
        backends,
      }),
    );

    return {
      kind: 'blocked',
      conversationId: pendingRun.conversationId,
      reason: 'backend-selection',
    };
  }

  const resolvedBackend = pendingRun.backend ?? evaluation.backend;
  const selection = await resolveModelSelection(pendingRun.conversationId, resolvedBackend);
  if (selection.requiresSelection && selection.backend) {
    pendingRun.backend = selection.backend;
    pendingRuns.set(pendingRun.conversationId, pendingRun);
    await publishBlocks(
      options.transport,
      pendingRun,
      'Choose Model',
      buildSlackModelSelectionBlocks({
        conversationId: pendingRun.conversationId,
        backend: selection.backend,
        models: selection.models,
      }),
    );

    clearPendingTimer(pendingRun.conversationId);
    const timeoutMs = options.modelSelectionTimeoutMs ?? 10_000;
    const timer = setTimeout(() => {
      pendingModelTimers.delete(pendingRun.conversationId);
      void autoSelectModelAndResume(options, pendingRun.conversationId);
    }, timeoutMs);
    maybeUnrefTimer(timer);
    pendingModelTimers.set(pendingRun.conversationId, timer);

    return {
      kind: 'blocked',
      conversationId: pendingRun.conversationId,
      reason: 'model-selection',
    };
  }

  clearPendingTimer(pendingRun.conversationId);
  pendingRuns.delete(pendingRun.conversationId);
  const reactionTarget = resolveReactionTarget(pendingRun);
  if (reactionTarget && hasReactionTransport(options.transport)) {
    await applySlackReaction(options.transport, reactionTarget, 'thinking', 'received');
  }
  const started = await runPlatformConversation({
    conversationId: pendingRun.conversationId,
    target: pendingRun.target,
    prompt: pendingRun.prompt,
    mode: pendingRun.mode,
    trigger: reactionTarget,
    sourceMessageId: pendingRun.sourceMessageId,
    backend: resolvedBackend,
    defaultCwd: options.defaultCwd,
    render: ({ target }, events) => streamSlackMessages({
      transport: options.transport,
      target: target as { channelId: string; threadTs: string },
      updateIntervalMs: options.config?.streamUpdateIntervalMs ?? 1_000,
      onPermissionRequested: async (event) => {
        await publishPermissionRequest(options.transport, pendingRun, event);
      },
      onPermissionResolved: async (event) => {
        await updatePermissionState(
          options.transport,
          pendingRun.conversationId,
          event.requestId,
          event.decision,
        );
      },
    }, events),
    onPhaseChange: async (phase, previousPhase, trigger) => {
      if (!trigger || !hasReactionTransport(options.transport)) {
        return;
      }

      const nextPhase = mapConversationPhaseToReaction(phase);
      const previousReactionPhase = previousPhase
        ? mapConversationPhaseToReaction(previousPhase)
        : 'thinking';
      await applySlackReaction(options.transport, trigger, nextPhase, previousReactionPhase);
    },
  });

  return started
    ? {
      kind: 'started',
      conversationId: pendingRun.conversationId,
      mode: pendingRun.mode,
    }
    : {
      kind: 'busy',
      conversationId: pendingRun.conversationId,
    };
}

async function autoSelectModelAndResume(options: SlackRuntimeOptions, conversationId: string): Promise<void> {
  const pendingRun = pendingRuns.get(conversationId);
  if (!pendingRun) {
    return;
  }

  const selection = await resolveModelSelection(conversationId, pendingRun.backend ?? conversationBackend.get(conversationId));
  if (selection.requiresSelection && selection.backend) {
    const fallbackModel = selection.models[0]?.id;
    if (!fallbackModel) {
      resetPendingRun(conversationId);
      return;
    }

    applySessionControlCommand({
      conversationId,
      type: 'model',
      value: fallbackModel,
    });
  }

  await continuePendingRun(options, pendingRun);
}

export function resetSlackRuntimeForTests(): void {
  for (const timer of pendingModelTimers.values()) {
    clearTimeout(timer);
  }
  pendingModelTimers.clear();
  pendingRuns.clear();
  pendingPermissions.clear();
}

export function hasPendingSlackRun(conversationId: string): boolean {
  return pendingRuns.has(conversationId);
}

export function createSlackRuntime(options: SlackRuntimeOptions): SlackRuntime {
  const createApp = options.createApp ?? createDefaultApp;

  async function handleCommand(command: SlackCommandPayload) {
    if (command.command === '/code' || command.command === '/ask') {
      const prompt = command.command === '/code'
        ? parseSlackCodeCommand(command.text)
        : parseSlackAskCommand(command.text);
      if (!prompt) {
        await options.transport.sendCommandResponse(command, 'Please provide a prompt.');
        return {
          kind: 'error' as const,
          message: 'Please provide a prompt.',
        };
      }

      const created = await (command.channel_id.startsWith('D')
        ? (() => options.transport.sendMessage({
          channelId: command.channel_id,
          text: `*${command.user_name ?? command.user_id}:* ${prompt}`,
        }).then(result => ({
          channelId: command.channel_id,
          threadTs: result.ts,
          rootMessageTs: result.ts,
          containerType: 'dm' as const,
        })))()
        : options.transport.createThread({
          channelId: command.channel_id,
          authorName: command.user_name ?? command.user_id,
          prompt,
        }).then(result => ({
          ...result,
          containerType: 'channel-thread' as const,
        })));
      const record = buildRuntimeConversationRecord(created);
      rememberSlackConversation(record);
      conversationMode.set(record.conversationId, command.command === '/code' ? 'code' : 'ask');

      return continuePendingRun(options, {
        conversationId: record.conversationId,
        target: {
          channelId: record.channelId,
          threadTs: record.threadTs,
        },
        prompt,
        mode: command.command === '/code' ? 'code' : 'ask',
        source: 'slash-command',
        sourceMessageId: command.command_ts,
      });
    }

    if (command.command === '/interrupt' || command.command === '/done' || command.command === '/skill') {
      const conversationId = command.command === '/interrupt'
        ? resolveSlackInterruptTarget(command.thread_ts ?? null)
        : command.command === '/done'
          ? resolveSlackDoneTarget(command.thread_ts ?? null)
          : command.thread_ts ?? null;
      const conversation = conversationId
        ? findSlackConversationByThreadTs(conversationId)
        : undefined;

      if (!conversation) {
        const message = 'This command only works inside an active Slack conversation thread.';
        await options.transport.sendCommandResponse(command, message);
        return {
          kind: 'error' as const,
          message,
        };
      }

      if (command.command === '/skill') {
        const parsed = parseSlackSkillCommand(command.text);
        if (!parsed) {
          await options.transport.sendCommandResponse(command, 'Usage: /skill <name> <prompt>');
          return {
            kind: 'error' as const,
            message: 'Usage: /skill <name> <prompt>',
          };
        }

        const availableSkills = await listSkills();
        const matched = availableSkills.find(skill => skill.name === parsed.skillName);
        if (!matched) {
          const message = `Unknown skill \`${parsed.skillName}\`.`;
          await options.transport.sendCommandResponse(command, message);
          return {
            kind: 'error' as const,
            message,
          };
        }

        return continuePendingRun(options, {
          conversationId: conversation.conversationId,
          target: {
            channelId: conversation.channelId,
            threadTs: conversation.threadTs,
          },
          prompt: `/${matched.name} ${parsed.prompt}`,
          mode: 'code',
          source: 'slash-command',
          sourceMessageId: command.command_ts,
        });
      }

      applySessionControlCommand({
        conversationId: conversation.conversationId,
        type: command.command === '/interrupt' ? 'interrupt' : 'done',
      });
      resetPendingRun(conversation.conversationId);
      return {
        kind: 'started' as const,
        conversationId: conversation.conversationId,
      };
    }

    const message = `Unsupported command: ${command.command}`;
    await options.transport.sendCommandResponse(command, message);
    return {
      kind: 'error' as const,
      message,
    };
  }

  async function handleAction(action: SlackActionPayload) {
    const payload = parseActionValue(action.actions[0] ?? {});
    if (!payload || typeof payload['conversationId'] !== 'string' || typeof payload['type'] !== 'string') {
      return {
        kind: 'error' as const,
        message: 'Invalid Slack action payload.',
      };
    }

    const conversationId = payload['conversationId'];
    const actionType = payload['type'];
    const value = payload['value'];

    if (actionType === 'backend' || actionType === 'model') {
      if (typeof value !== 'string') {
        return {
          kind: 'error' as const,
          message: 'Invalid Slack action value.',
        };
      }
      applySessionControlCommand({
        conversationId,
        type: actionType,
        value,
      });
      const pendingRun = pendingRuns.get(conversationId);
      if (!pendingRun) {
        return {
          kind: 'error' as const,
          message: 'No pending Slack run for this action.',
        };
      }
      return continuePendingRun(options, pendingRun).then(result => ({
        kind: result.kind,
        conversationId: conversationId,
      }));
    }

    if (actionType === 'permission') {
      if (typeof payload['requestId'] !== 'string' || (payload['decision'] !== 'approved' && payload['decision'] !== 'denied')) {
        return {
          kind: 'error' as const,
          message: 'Invalid Slack permission action payload.',
        };
      }

      try {
        const resolved = resolvePermissionRequest({
          conversationId,
          requestId: payload['requestId'],
          decision: payload['decision'],
        });
        await updatePermissionState(
          options.transport,
          conversationId,
          payload['requestId'],
          resolved.decision,
        );
        return {
          kind: 'resolved' as const,
          conversationId,
        };
      } catch {
        return {
          kind: 'error' as const,
          message: 'This permission request is no longer pending.',
        };
      }
    }

    return {
      kind: 'error' as const,
      message: `Unsupported Slack action type: ${actionType}`,
    };
  }

  async function handleMessage(message: SlackMessageEvent) {
    if (!shouldProcessSlackMessage(message)) {
      return {
        kind: 'ignored' as const,
      };
    }

    const conversationId = resolveSlackConversationIdForMessage(message);
    if (!conversationId) {
      if (!isSlackDirectMessage(message)) {
        return {
          kind: 'ignored' as const,
        };
      }

      const record = buildRootConversationRecord(message, 'dm');
      rememberSlackConversation(record);
      conversationMode.set(record.conversationId, 'code');
      await maybeMarkSlackMessageReceived(options.transport, {
        channelId: record.channelId,
        messageTs: message.ts,
      });
      return continuePendingRun(options, {
        conversationId: record.conversationId,
        target: {
          channelId: record.channelId,
          threadTs: record.threadTs,
        },
        prompt: normalizeSlackPrompt(message.text),
        mode: 'code',
        source: 'dm-message',
        sourceMessageId: message.ts,
      });
    }

    const conversation = findSlackConversationByThreadTs(conversationId);
    if (!conversation) {
      return {
        kind: 'ignored' as const,
      };
    }

    return continuePendingRun(options, {
      conversationId,
      target: {
        channelId: conversation.channelId,
        threadTs: conversation.threadTs,
      },
      prompt: normalizeSlackPrompt(message.text),
      mode: conversationMode.get(conversationId) ?? 'code',
      source: 'thread-message',
      sourceMessageId: message.ts,
    });
  }

  async function handleAppMention(message: SlackMessageEvent) {
    if (!message.user || message.bot_id || message.subtype === 'bot_message') {
      return {
        kind: 'ignored' as const,
      };
    }

    if (message.thread_ts) {
      return handleMessage(message);
    }

    const record = buildRootConversationRecord(message, 'channel-thread');
    rememberSlackConversation(record);
    conversationMode.set(record.conversationId, 'code');
    await maybeMarkSlackMessageReceived(options.transport, {
      channelId: record.channelId,
      messageTs: message.ts,
    });

    return continuePendingRun(options, {
      conversationId: record.conversationId,
      target: {
        channelId: record.channelId,
        threadTs: record.threadTs,
      },
      prompt: normalizeSlackPrompt(message.text),
      mode: 'code',
      source: 'app_mention',
      sourceMessageId: message.ts,
    });
  }

  async function start(): Promise<void> {
    const config = options.config ?? readSlackConfig();
    const app = createApp(config);
    await (app as any).client?.users?.setPresence?.({ presence: 'auto' }).catch?.(() => {});
    app.command('/code', async ({ command, ack }: any) => {
      await ack();
      await handleCommand(command as SlackCommandPayload);
    });
    app.command('/ask', async ({ command, ack }: any) => {
      await ack();
      await handleCommand(command as SlackCommandPayload);
    });
    app.command('/interrupt', async ({ command, ack }: any) => {
      await ack();
      await handleCommand(command as SlackCommandPayload);
    });
    app.command('/done', async ({ command, ack }: any) => {
      await ack();
      await handleCommand(command as SlackCommandPayload);
    });
    app.command('/skill', async ({ command, ack }: any) => {
      await ack();
      await handleCommand(command as SlackCommandPayload);
    });
    app.action(/.*/, async ({ body, ack, action }: any) => {
      await ack();
      const result = await handleAction({
        channel: { id: body.channel.id },
        message: {
          ts: body.message.ts,
          thread_ts: body.message.thread_ts,
        },
        actions: [action],
        user: { id: body.user.id },
      });
      if (result.kind === 'error') {
        const threadTs = body.message.thread_ts ?? body.message.ts;
        const postEphemeral = (app as any).client?.chat?.postEphemeral;
        if (typeof postEphemeral === 'function') {
          await postEphemeral({
            channel: body.channel.id,
            user: body.user.id,
            text: result.message,
            ...(threadTs ? { thread_ts: threadTs } : {}),
          }).catch(async () => {
            await options.transport.sendText({ channelId: body.channel.id, threadTs }, result.message);
          });
          return;
        }
        await options.transport.sendText({ channelId: body.channel.id, threadTs }, result.message);
      }
    });
    app.event('app_mention', async ({ event }: any) => {
      await handleAppMention(event as SlackMessageEvent);
    });
    app.event('message', async ({ event }: any) => {
      await handleMessage(event as SlackMessageEvent);
    });
    await app.start();
  }

  return {
    start,
    handleCommand,
    handleAction,
    handleMessage,
  };
}

export async function startSlackRuntime(config: SlackConfig = readSlackConfig()): Promise<SlackRuntime> {
  const app = new App({
    token: config.slackBotToken,
    signingSecret: config.slackSigningSecret,
    socketMode: config.slackSocketMode,
    appToken: config.slackAppToken,
  });
  const runtime = createSlackRuntime({
    config,
    transport: createSlackBoltTransport(app),
    defaultCwd: config.claudeCwd,
    createApp: () => app as unknown as SlackAppLike,
  });
  await runtime.start();
  return runtime;
}

export function isSlackRuntimeMainModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return fileURLToPath(import.meta.url) === process.argv[1];
}
