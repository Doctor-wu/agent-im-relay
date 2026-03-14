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
        reply_to_message_id: options?.replyToMessageId,
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

function isForum(ctx: Context): boolean {
  const chat = ctx.chat;
  return (
    chat?.type === 'supergroup' &&
    'is_forum' in chat &&
    chat.is_forum === true
  );
}

// --- Forum Topic support ---
// In Forum groups: auto-create a Topic per conversation (like Discord threads).
// Called when a message arrives in the general chat of a forum group.
// Returns a new TelegramTarget pointing to the created topic, or null if not applicable.

async function ensureForumThread(
  bot: Bot,
  ctx: Context,
  prompt: string,
): Promise<TelegramTarget | null> {
  // Only applicable to forum supergroups
  if (!isForum(ctx)) return null;

  // Already inside a topic — no need to create one
  if (ctx.message?.message_thread_id) return null;

  const chatId = ctx.chat!.id;
  const topicName = prompt.slice(0, 48).trim() || 'New task';

  try {
    const topic = await bot.api.createForumTopic(chatId, topicName);
    const threadId = topic.message_thread_id;

    // Echo the original message into the topic for context
    const authorName = ctx.from?.first_name ?? 'User';
    await bot.api.sendMessage(
      chatId,
      `<b>${authorName}:</b> ${prompt}`,
      { parse_mode: 'HTML', message_thread_id: threadId },
    );

    return { chatId, threadId };
  } catch (err) {
    console.error('[telegram] failed to create forum topic:', err);
    return null;
  }
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
        reply_to_message_id: target.replyToMessageId,
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

  // Tracks comment threads started from channel post auto-forwards.
  // Keyed by `${chatId}:${rootMsgId}` so lookups can match either
  // message_thread_id or reply_to_message_id — Telegram is inconsistent about
  // which one it sets in non-Forum discussion groups.
  const COMMENT_THREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  type CommentThreadEntry = { conversationId: string; rootMsgId: number; ts: number };
  const commentThreadsByRoot = new Map<string, CommentThreadEntry>();

  const commentThreadCleanupTimer = setInterval(() => {
    const cutoff = Date.now() - COMMENT_THREAD_TTL_MS;
    for (const [key, entry] of commentThreadsByRoot) {
      if (entry.ts < cutoff) commentThreadsByRoot.delete(key);
    }
  }, 60 * 60 * 1000); // hourly

  function registerCommentThread(chatId: number, rootMsgId: number, conversationId: string): void {
    commentThreadsByRoot.set(`${chatId}:${rootMsgId}`, { conversationId, rootMsgId, ts: Date.now() });
  }

  function findCommentThread(chatId: number, msgId?: number): CommentThreadEntry | undefined {
    if (!msgId) return undefined;
    const entry = commentThreadsByRoot.get(`${chatId}:${msgId}`);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > COMMENT_THREAD_TTL_MS) {
      commentThreadsByRoot.delete(`${chatId}:${msgId}`);
      return undefined;
    }
    entry.ts = Date.now(); // refresh TTL on activity
    return entry;
  }

  function isAllowed(userId: number): boolean {
    if (!config.telegramAllowedUserIds?.length) return true;
    return config.telegramAllowedUserIds.includes(userId);
  }

  function getTarget(ctx: Context, opts: { withReply?: boolean } = {}): TelegramTarget | null {
    const chatId = ctx.chat?.id;
    if (!chatId) return null;
    const threadId = ctx.message?.message_thread_id;
    // In group chats, replying to the trigger message creates a visible reply thread
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    const replyToMessageId =
      opts.withReply && isGroup ? ctx.message?.message_id : undefined;
    return { chatId, threadId, replyToMessageId };
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
    const prompt = ctx.match?.trim();
    if (!prompt) {
      await replyEphemeral(ctx, 'Usage: /code <prompt>');
      return;
    }
    const baseTarget = getTarget(ctx, { withReply: true });
    if (!baseTarget) return;
    const target = (await ensureForumThread(bot, ctx, prompt)) ?? baseTarget;
    const conversationId = resolveTelegramConversationId(target.chatId, target.threadId);
    await handleConversation(ctx, transport, config, target, conversationId, prompt);
  });

  // /ask command
  bot.command('ask', async (ctx) => {
    if (!isAllowed(ctx.from?.id ?? 0)) return;
    const prompt = ctx.match?.trim();
    if (!prompt) {
      await replyEphemeral(ctx, 'Usage: /ask <question>');
      return;
    }
    const baseTarget = getTarget(ctx, { withReply: true });
    if (!baseTarget) return;
    const target = (await ensureForumThread(bot, ctx, prompt)) ?? baseTarget;
    const conversationId = resolveTelegramConversationId(target.chatId, target.threadId);
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
    // Close the forum topic to visually mark the session as done
    if (target.threadId && isForum(ctx)) {
      await bot.api.closeForumTopic(target.chatId, target.threadId).catch(() => {});
    }
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

  // Auto-respond to channel posts forwarded to linked discussion group.
  // When Discussion is enabled on a channel, each post is auto-forwarded to the
  // discussion group. Bot detects this and starts a session in that post's comment thread.
  bot.on('message', async (ctx, next) => {
    // Non-auto-forwarded messages must pass through to the message:text handler below.
    // Calling next() here is critical — a bare `return` would stop the middleware chain.
    if (!ctx.message.is_automatic_forward) return next();

    const text = ctx.message.text ?? ctx.message.caption;
    if (!text?.trim()) return next();

    const chatId = ctx.chat.id;
    // Discussion groups are regular supergroups (not Forum), so message_thread_id doesn't work.
    // Reply to the forwarded post instead — this places messages in the post's comment thread.
    const forwardedMsgId = ctx.message.message_id;
    const target: TelegramTarget = { chatId, replyToMessageId: forwardedMsgId };
    const conversationId = resolveTelegramConversationId(chatId, forwardedMsgId);

    registerCommentThread(chatId, forwardedMsgId, conversationId);
    await handleConversation(ctx, transport, config, target, conversationId, text.trim());
  });

  // Handle plain text messages — continue active conversations or start new ones
  bot.on('message:text', async (ctx) => {
    // Auto-forwarded channel posts are handled by the channel post handler above
    if (ctx.message.is_automatic_forward) return;

    if (!isAllowed(ctx.from?.id ?? 0)) return;
    const baseTarget = getTarget(ctx, { withReply: true });
    if (!baseTarget) return;

    const text = ctx.message.text ?? '';
    // Skip if it's a command
    if (text.startsWith('/')) return;

    const chatType = ctx.chat?.type;
    const isPrivate = chatType === 'private';
    const botUsername = ctx.me.username;
    const isMentioned = botUsername ? text.toLowerCase().includes(`@${botUsername.toLowerCase()}`) : false;

    // In discussion groups, Telegram is inconsistent: follow-up messages may carry
    // message_thread_id = forwardedMsgId, or only reply_to_message_id = forwardedMsgId,
    // or sometimes both. Check both fields against known comment thread roots.
    const chatId = ctx.chat!.id;
    const commentEntry =
      findCommentThread(chatId, ctx.message.message_thread_id) ??
      findCommentThread(chatId, ctx.message.reply_to_message?.message_id);

    const baseConversationId = commentEntry?.conversationId
      ?? resolveTelegramConversationId(baseTarget.chatId, baseTarget.threadId);
    const hasActive = isActiveConversation(baseConversationId);
    const inCommentThread = !!commentEntry;

    if (!isPrivate && !isMentioned && !hasActive && !inCommentThread) return;

    const prompt = extractPrompt(text, botUsername);
    if (!prompt) return;

    // For known comment threads (channel discussions): reply to the thread root so
    // responses appear in the comment section. Use the stored rootMsgId, not the
    // user's current message_thread_id / reply_to_message_id which may vary.
    // For forum groups: if in general chat and @mentioned, spin up a new topic.
    // For regular groups: use reply thread (replyToMessageId already set via withReply).
    let target = baseTarget;
    let conversationId = baseConversationId;
    if (inCommentThread && commentEntry) {
      target = { chatId, replyToMessageId: commentEntry.rootMsgId };
      conversationId = commentEntry.conversationId;
    } else if (isMentioned && isForum(ctx) && !ctx.message?.message_thread_id) {
      target = (await ensureForumThread(bot, ctx, prompt)) ?? baseTarget;
      conversationId = resolveTelegramConversationId(target.chatId, target.threadId);
    }

    await handleConversation(ctx, transport, config, target, conversationId, prompt);
  });

  bot.catch((err) => {
    console.error('[telegram] bot error:', err);
  });

  // Expose cleanup so the runtime can clear the interval on shutdown
  (bot as Bot & { _cleanup?: () => void })._cleanup = () => {
    clearInterval(commentThreadCleanupTimer);
    commentThreadsByRoot.clear();
  };

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
      (bot as Bot & { _cleanup?: () => void })._cleanup?.();
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
