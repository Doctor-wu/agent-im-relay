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
  readCoreConfig,
  resolveBackendModelId,
  runPlatformConversation,
  type AgentStreamEvent,
  type BackendModel,
  type BackendName,
  type AgentMode,
} from '@agent-im-relay/core';
import { buildSlackBackendSelectionBlocks, buildSlackModelSelectionBlocks, type SlackBlock } from './cards.js';
import { parseSlackAskCommand } from './commands/ask.js';
import { parseSlackCodeCommand } from './commands/code.js';
import { resolveSlackDoneTarget } from './commands/done.js';
import { resolveSlackInterruptTarget } from './commands/interrupt.js';
import { parseSlackSkillCommand } from './commands/skill.js';
import { buildSlackConversationId, resolveSlackConversationIdForMessage, shouldProcessSlackMessage, type SlackMessageEvent } from './conversation.js';
import { readSlackConfig, type SlackConfig } from './config.js';
import {
  findSlackConversationByThreadTs,
  rememberSlackConversation,
  type SlackConversationRecord,
} from './state.js';

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
  sourceMessageId?: string;
  cardMessageTs?: string;
  backend?: BackendName;
};

const pendingRuns = new Map<string, SlackPendingRun>();
const pendingModelTimers = new Map<string, ReturnType<typeof setTimeout>>();

function maybeUnrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }
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

function buildRuntimeConversationRecord(created: {
  channelId: string;
  threadTs: string;
  rootMessageTs: string;
}): SlackConversationRecord {
  const conversationId = buildSlackConversationId(created.threadTs);
  return {
    conversationId,
    channelId: created.channelId,
    threadTs: created.threadTs,
    rootMessageTs: created.rootMessageTs,
  };
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

async function renderSlackEvents(
  transport: SlackRuntimeTransport,
  target: { channelId: string; threadTs: string },
  events: AsyncIterable<AgentStreamEvent>,
): Promise<void> {
  let finalText = '';

  for await (const event of events) {
    if (event.type === 'done') {
      finalText = event.result;
      continue;
    }

    if (event.type === 'error') {
      await transport.sendText(target, `Error: ${event.error}`);
      return;
    }
  }

  if (finalText) {
    await transport.sendText(target, finalText);
  }
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
  const started = await runPlatformConversation({
    conversationId: pendingRun.conversationId,
    target: pendingRun.target,
    prompt: pendingRun.prompt,
    mode: pendingRun.mode,
    sourceMessageId: pendingRun.sourceMessageId,
    backend: resolvedBackend,
    defaultCwd: options.defaultCwd,
    render: ({ target }, events) => renderSlackEvents(options.transport, target as { channelId: string; threadTs: string }, events),
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

      const created = await options.transport.createThread({
        channelId: command.channel_id,
        authorName: command.user_name ?? command.user_id,
        prompt,
      });
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
      applySessionControlCommand({
        conversationId,
        type: actionType,
        value: typeof value === 'string' ? value : undefined,
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
      return {
        kind: 'ignored' as const,
      };
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
      prompt: message.text?.trim() ?? '',
      mode: conversationMode.get(conversationId) ?? 'code',
      sourceMessageId: message.ts,
    });
  }

  async function start(): Promise<void> {
    const config = options.config ?? {
      ...readCoreConfig(),
      slackBotToken: 'test-bot-token',
      slackAppToken: 'test-app-token',
      slackSigningSecret: 'test-signing-secret',
      slackSocketMode: true,
    };
    const app = createApp(config);
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
      await handleAction({
        channel: { id: body.channel.id },
        message: {
          ts: body.message.ts,
          thread_ts: body.message.thread_ts,
        },
        actions: [action],
        user: { id: body.user.id },
      });
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
