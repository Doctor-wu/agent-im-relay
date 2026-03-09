import { randomUUID } from 'node:crypto';
import type { AnyThreadChannel, Message } from 'discord.js';
import {
  runPlatformConversation,
  type AgentBackend,
  type BackendName,
  conversationBackend,
  persistState,
  threadSessionBindings,
} from '@agent-im-relay/core';
import { config } from './config.js';
import { publishConversationArtifacts } from './artifacts.js';
import { prepareAttachmentPrompt, type DiscordAttachmentLike } from './files.js';
import { streamAgentToDiscord, type StreamTargetChannel } from './stream.js';
import type { DiscordReplyContext } from './reply-context.js';

type ReactionPhase = 'received' | 'thinking' | 'tools' | 'done' | 'error';

type SetReaction = (
  message: Message,
  phase: ReactionPhase,
  currentPhase?: ReactionPhase,
) => Promise<void>;

type RunMentionConversationOptions = {
  backend?: BackendName | AgentBackend;
  attachments?: DiscordAttachmentLike[];
  createSessionId?: () => string;
  persist?: () => Promise<void>;
  setReaction?: SetReaction;
  replyContext?: DiscordReplyContext;
  streamToDiscord?: (
    options: {
      channel: StreamTargetChannel;
      initialMessage?: Message<boolean>;
      replyContext?: DiscordReplyContext;
    },
    events: AsyncIterable<import('@agent-im-relay/core').AgentStreamEvent>,
  ) => Promise<void>;
};

export function hasOpenStickyThreadSession(conversationId: string): boolean {
  return threadSessionBindings.has(conversationId);
}

async function persistDiscordState(): Promise<void> {
  await persistState('discord');
}

export async function runMentionConversation(
  thread: AnyThreadChannel & StreamTargetChannel,
  prompt: string,
  triggerMsg?: Message,
  options: RunMentionConversationOptions = {},
): Promise<boolean> {
  if (triggerMsg && options.setReaction) {
    await options.setReaction(triggerMsg, 'thinking', 'received');
  }

  return runPlatformConversation({
    conversationId: thread.id,
    target: thread,
    prompt,
    trigger: triggerMsg,
    sourceMessageId: triggerMsg?.id,
    backend: options.backend ?? conversationBackend.get(thread.id),
    defaultCwd: config.claudeCwd,
    createSessionId: options.createSessionId ?? (() => randomUUID()),
    persist: options.persist ?? persistDiscordState,
    attachments: options.attachments ?? [],
    render: ({ target, showEnvironment }, events) =>
      (options.streamToDiscord ?? streamAgentToDiscord)({
        channel: target,
        showEnvironment,
        replyContext: options.replyContext,
      }, events),
    publishArtifacts: async ({ conversationId, cwd, files, warnings, sourceMessageId, target }) =>
      publishConversationArtifacts({
        conversationId,
        cwd,
        stagedFiles: files,
        warnings,
        channel: target,
        sourceMessageId,
        replyContext: options.replyContext,
      }),
    onPhaseChange: async (phase, previousPhase, trigger) => {
      if (!trigger || !options.setReaction) {
        return;
      }

      if (phase === 'tools') {
        await options.setReaction(trigger, 'tools', previousPhase as ReactionPhase | undefined);
        return;
      }

      if (phase === 'error') {
        await options.setReaction(trigger, 'error', previousPhase as ReactionPhase | undefined);
        return;
      }

      await options.setReaction(trigger, 'done', previousPhase as ReactionPhase | undefined);
    },
  });
}
