import { fileURLToPath } from 'node:url';
import { Bot, InputFile, InlineKeyboard, type Context } from 'grammy';
import {
  activeConversations,
  conversationBackend,
  conversationCwd,
  initState,
  interruptConversationRun,
  persistState,
  processedMessages,
  threadSessionBindings,
  type BackendName,
} from '@agent-im-relay/core';
import {
  applyTelegramConfigEnvironment,
  readTelegramConfig,
  type TelegramConfig,
} from './config.js';
import {
  beginTelegramConversationRun,
  dispatchTelegramControlAction,
  resolveTelegramConversationId,
  resolvePromptMode,
  runTelegramConversation,
  takePendingTelegramRun,
  type TelegramTarget,
  type TelegramTransport,
} from './runtime.js';

// --- Transport implementation ---

function createBotTransport(bot: Bot): TelegramTransport {
  return {
    async sendMessage(target, text, options) {
      const msg = await bot.api.sendMessage(target.chatId, text || '…', {
        parse_mode: options?.parseMode,
        message_thread_id: target.threadId,
      });
      return msg.message_id;
    },
    async editMessage(chatId, messageId, text, options) {
      await bot.api.editMessageText(chatId, messageId, text || '…', {
        parse_mode: options?.parseMode,
      });
    },
    async sendDocument(target, filePath, caption) {
      await bot.api.sendDocument(
        target.chatId,
        new InputFile(filePath),
        { caption, message_thread_id: target.threadId },
      );
    },
  };
}

// --- Helpers ---

function extractPrompt(text: string, botUsername?: string): string {
  let content = text.trim();
  if (botUsername) {
    const mentionRegex = new RegExp(`^@${botUsername}\\s*`, 'i');
    content = content.replace(mentionRegex, '').trim();
  }
  // Strip leading slash command
  content = content.replace(/^\/\w+(@\S+)?\s*/, '').trim();
  return content;
}

function isActiveConversation(conversationId: string): boolean {
  return threadSessionBindings.has(conversationId) || activeConversations.has(conversationId);
}

async function replyEphemeral(ctx: Context, text: string): Promise<void> {
  await ctx.reply(text).catch(() => {});
}

// --- Backend selection inline keyboard ---

const BACKEND_CALLBACK_PREFIX = 'backend:';

function buildBackendKeyboard(conversationId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Claude (Claude Code)', `${BACKEND_CALLBACK_PREFIX}claude:${conversationId}`)
    .text('Codex (OpenAI Codex)', `${BACKEND_CALLBACK_PREFIX}codex:${conversationId}`);
}

// --- Main conversation runner ---

async function handleConversation(
  ctx: Context,
  transport: TelegramTransport,
  telegramConfig: TelegramConfig,
  target: TelegramTarget,
  conversationId: string,
  rawText: string,
): Promise<void> {
  const dedup = `${conversationId}:${rawText.slice(0, 64)}`;
  if (processedMessages.has(dedup)) return;
  processedMessages.add(dedup);
  setTimeout(() => processedMessages.delete(dedup), 60_000);

  const { mode, prompt } = resolvePromptMode(rawText);
  if (!prompt) {
    await replyEphemeral(ctx, 'Please include a prompt after the command.');
    return;
  }

  const gate = beginTelegramConversationRun(conversationId);
  if (gate.kind === 'blocked') {
    await ctx.reply(
      `<b>选择 AI Backend</b>\n> ${prompt.slice(0, 200)}`,
      {
        parse_mode: 'HTML',
        reply_markup: buildBackendKeyboard(conversationId),
        message_thread_id: target.threadId,
      },
    );
    // Store the pending run so we can resume after backend selection
    takePendingTelegramRun(conversationId); // clear any stale run
    await runTelegramConversation({
      conversationId,
      target,
      prompt,
      mode,
      transport,
      defaultCwd: telegramConfig.claudeCwd,
      streamUpdateIntervalMs: telegramConfig.telegramStreamUpdateIntervalMs,
      messageCharLimit: telegramConfig.telegramMessageCharLimit,
      persistState: () => persistState('telegram'),
    });
    return;
  }

  await runTelegramConversation({
    conversationId,
    target,
    prompt,
    mode,
    transport,
    defaultCwd: telegramConfig.claudeCwd,
    streamUpdateIntervalMs: telegramConfig.telegramStreamUpdateIntervalMs,
    messageCharLimit: telegramConfig.telegramMessageCharLimit,
    persistState: () => persistState('telegram'),
  });
}

// --- Bot setup ---

export function createTelegramBot(config: TelegramConfig): Bot {
  const bot = new Bot(config.telegramBotToken);
  const transport = createBotTransport(bot);

  function isAllowed(userId: number): boolean {
    if (!config.telegramAllowedUserIds?.length) return true;
    return config.telegramAllowedUserIds.includes(userId);
  }

  function getTarget(ctx: Context): TelegramTarget | null {
    const chatId = ctx.chat?.id;
    if (!chatId) return null;
    const threadId = ctx.message?.message_thread_id;
    return { chatId, threadId };
  }

  // /start command
  bot.command('start', async (ctx) => {
    await ctx.reply(
      '<b>Agent IM Relay — Telegram</b>\n\n' +
      'Send me a message to start a coding task (Claude or Codex).\n\n' +
      '<b>Commands:</b>\n' +
      '• /code — Start a coding task\n' +
      '• /ask — Quick question (no file tools)\n' +
      '• /interrupt — Interrupt current task\n' +
      '• /done — Clear session continuation\n' +
      '• /backend — Switch AI backend\n' +
      '• /status — Show active sessions',
      { parse_mode: 'HTML' },
    );
  });

  // /code command
  bot.command('code', async (ctx) => {
    if (!isAllowed(ctx.from?.id ?? 0)) return;
    const target = getTarget(ctx);
    if (!target) return;
    const conversationId = resolveTelegramConversationId(target.chatId, target.threadId);
    const prompt = ctx.match?.trim();
    if (!prompt) {
      await replyEphemeral(ctx, 'Usage: /code <prompt>');
      return;
    }
    await handleConversation(ctx, transport, config, target, conversationId, prompt);
  });

  // /ask command
  bot.command('ask', async (ctx) => {
    if (!isAllowed(ctx.from?.id ?? 0)) return;
    const target = getTarget(ctx);
    if (!target) return;
    const conversationId = resolveTelegramConversationId(target.chatId, target.threadId);
    const prompt = ctx.match?.trim();
    if (!prompt) {
      await replyEphemeral(ctx, 'Usage: /ask <question>');
      return;
    }
    await handleConversation(ctx, transport, config, target, conversationId, `/ask ${prompt}`);
  });

  // /interrupt command
  bot.command('interrupt', async (ctx) => {
    if (!isAllowed(ctx.from?.id ?? 0)) return;
    const target = getTarget(ctx);
    if (!target) return;
    const conversationId = resolveTelegramConversationId(target.chatId, target.threadId);
    const result = dispatchTelegramControlAction({ type: 'interrupt', conversationId });
    await replyEphemeral(
      ctx,
      result.kind === 'interrupt' && result.interrupted
        ? '⏹️ Interrupted current run.'
        : 'No active run to interrupt.',
    );
  });

  // /done command
  bot.command('done', async (ctx) => {
    if (!isAllowed(ctx.from?.id ?? 0)) return;
    const target = getTarget(ctx);
    if (!target) return;
    const conversationId = resolveTelegramConversationId(target.chatId, target.threadId);
    const result = dispatchTelegramControlAction({ type: 'done', conversationId });
    await replyEphemeral(
      ctx,
      result.kind === 'done' && result.clearContinuation
        ? '✅ Continuation cleared.'
        : 'No saved continuation to clear.',
    );
  });

  // /backend command
  bot.command('backend', async (ctx) => {
    if (!isAllowed(ctx.from?.id ?? 0)) return;
    const target = getTarget(ctx);
    if (!target) return;
    const conversationId = resolveTelegramConversationId(target.chatId, target.threadId);
    await ctx.reply(
      'Select AI backend:',
      {
        reply_markup: buildBackendKeyboard(conversationId),
        message_thread_id: target.threadId,
      },
    );
  });

  // /status command
  bot.command('status', async (ctx) => {
    if (!isAllowed(ctx.from?.id ?? 0)) return;
    const target = getTarget(ctx);
    if (!target) return;
    const conversationId = resolveTelegramConversationId(target.chatId, target.threadId);
    const backend = conversationBackend.get(conversationId);
    const cwd = conversationCwd.get(conversationId);
    const running = activeConversations.has(conversationId);
    const hasSession = threadSessionBindings.has(conversationId);

    const lines = [
      `<b>Session status</b>`,
      `- Conversation ID: <code>${conversationId}</code>`,
      `- Backend: ${backend ?? 'not set'}`,
      `- Running: ${running ? 'yes' : 'no'}`,
      `- Has continuation: ${hasSession ? 'yes' : 'no'}`,
      cwd ? `- Working dir: <code>${cwd}</code>` : '',
    ].filter(Boolean);

    await replyEphemeral(ctx, lines.join('\n'));
  });

  // Handle backend selection callback
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith(BACKEND_CALLBACK_PREFIX)) return;

    const rest = data.slice(BACKEND_CALLBACK_PREFIX.length);
    const colonIndex = rest.indexOf(':');
    if (colonIndex === -1) return;

    const selectedBackend = rest.slice(0, colonIndex) as BackendName;
    const conversationId = rest.slice(colonIndex + 1);

    if (!['claude', 'codex'].includes(selectedBackend)) return;

    conversationBackend.set(conversationId, selectedBackend);
    await persistState('telegram');

    await ctx.answerCallbackQuery({ text: `✅ Backend set to ${selectedBackend}` });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await ctx.editMessageText(`✅ Backend: <b>${selectedBackend}</b>`, { parse_mode: 'HTML' }).catch(() => {});

    // Resume any pending run for this conversation
    const pending = takePendingTelegramRun(conversationId);
    if (pending) {
      await runTelegramConversation({
        conversationId,
        target: pending.target,
        prompt: pending.prompt,
        mode: pending.mode,
        transport,
        defaultCwd: config.claudeCwd,
        streamUpdateIntervalMs: config.telegramStreamUpdateIntervalMs,
        messageCharLimit: config.telegramMessageCharLimit,
        sourceMessageId: pending.sourceMessageId,
        attachments: pending.attachments,
        persistState: () => persistState('telegram'),
      });
    }
  });

  // Handle plain text messages — continue active conversations
  bot.on('message:text', async (ctx) => {
    if (!isAllowed(ctx.from?.id ?? 0)) return;
    const target = getTarget(ctx);
    if (!target) return;

    const text = ctx.message.text ?? '';
    // Skip if it's a command
    if (text.startsWith('/')) return;

    const conversationId = resolveTelegramConversationId(target.chatId, target.threadId);

    // In private chats: always respond
    // In groups: only respond if there's an active session or the bot is mentioned
    const chatType = ctx.chat?.type;
    const isPrivate = chatType === 'private';
    const botUsername = ctx.me.username;
    const isMentioned = botUsername ? text.toLowerCase().includes(`@${botUsername.toLowerCase()}`) : false;
    const hasActive = isActiveConversation(conversationId);

    if (!isPrivate && !isMentioned && !hasActive) return;

    const prompt = extractPrompt(text, botUsername);
    if (!prompt) return;

    await handleConversation(ctx, transport, config, target, conversationId, prompt);
  });

  bot.catch((err) => {
    console.error('[telegram] bot error:', err);
  });

  return bot;
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  return fileURLToPath(import.meta.url) === process.argv[1];
}

export interface TelegramRuntime {
  readonly started: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createTelegramRuntime(config: TelegramConfig = readTelegramConfig()): TelegramRuntime {
  applyTelegramConfigEnvironment(config);
  const bot = createTelegramBot(config);
  let started = false;

  return {
    get started() { return started; },
    async start() {
      if (started) return;
      await initState('telegram');
      await bot.start({
        onStart(info) {
          console.log(`[telegram] logged in as @${info.username}`);
        },
      });
      started = true;
    },
    async stop() {
      if (!started) return;
      await bot.stop();
      started = false;
    },
  };
}

export async function startTelegramRuntime(): Promise<TelegramRuntime> {
  const runtime = createTelegramRuntime();
  await runtime.start();
  return runtime;
}

if (isMainModule()) {
  void startTelegramRuntime().catch((error) => {
    console.error('[telegram] failed to start:', error);
    process.exitCode = 1;
  });
}
