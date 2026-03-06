import { randomUUID } from 'node:crypto';
import type { AnyThreadChannel, Message } from 'discord.js';
import {
  runConversationSession,
  type AgentBackend,
  type AgentStreamEvent,
  type BackendName,
  conversationSessions,
  conversationModels,
  conversationEffort,
  conversationCwd,
  conversationBackend,
  activeConversations,
  persistState,
} from '@agent-im-relay/core';
import { config } from './config.js';
import { publishConversationArtifacts } from './artifacts.js';
import { prepareAttachmentPrompt, type DiscordAttachmentLike } from './files.js';
import { streamAgentToDiscord, type StreamTargetChannel } from './stream.js';

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
  streamToDiscord?: (
    options: { channel: StreamTargetChannel; initialMessage?: Message<boolean> },
    events: AsyncIterable<AgentStreamEvent>,
  ) => Promise<void>;
};

async function* captureAgentEvents(
  events: AsyncIterable<AgentStreamEvent>,
  onEvent: (event: AgentStreamEvent) => void,
): AsyncGenerator<AgentStreamEvent, void> {
  for await (const event of events) {
    onEvent(event);
    yield event;
  }
}

export async function runMentionConversation(
  thread: AnyThreadChannel & StreamTargetChannel,
  prompt: string,
  triggerMsg?: Message,
  options: RunMentionConversationOptions = {},
): Promise<boolean> {
  if (activeConversations.has(thread.id)) {
    return false;
  }

  activeConversations.add(thread.id);
  let phase: ReactionPhase = 'thinking';
  if (triggerMsg && options.setReaction) {
    await options.setReaction(triggerMsg, 'thinking', 'received');
  }

  try {
    const existingSessionId = conversationSessions.get(thread.id);
    const isResume = !!existingSessionId;
    const showEnvironment = !existingSessionId;
    const sessionId = existingSessionId ?? options.createSessionId?.() ?? randomUUID();
    const runCwd = conversationCwd.get(thread.id) ?? config.claudeCwd;
    const preparedPrompt = await prepareAttachmentPrompt({
      conversationId: thread.id,
      prompt,
      attachments: options.attachments ?? [],
      sourceMessageId: triggerMsg?.id,
    });

    conversationSessions.set(thread.id, sessionId);

    const events = runConversationSession(thread.id, {
      mode: 'code',
      prompt: preparedPrompt.prompt,
      model: conversationModels.get(thread.id),
      effort: conversationEffort.get(thread.id),
      cwd: runCwd,
      backend: options.backend ?? conversationBackend.get(thread.id),
      ...(isResume ? { resumeSessionId: sessionId } : { sessionId }),
    });

    let resolvedSessionId = sessionId;
    let finalResult = '';

    await (options.streamToDiscord ?? streamAgentToDiscord)(
      { channel: thread, showEnvironment },
      captureAgentEvents(events, (event) => {
        if (event.type === 'tool' && phase !== 'tools' && phase !== 'error') {
          const previousPhase = phase;
          phase = 'tools';
          if (triggerMsg && options.setReaction) {
            void options.setReaction(triggerMsg, 'tools', previousPhase);
          }
        } else if (event.type === 'done') {
          finalResult = event.result;
          if (event.sessionId) resolvedSessionId = event.sessionId;
        } else if (event.type === 'error') {
          const previousPhase = phase;
          phase = 'error';
          if (triggerMsg && options.setReaction) {
            void options.setReaction(triggerMsg, 'error', previousPhase);
          }
        }

        if (
          event.type === 'environment'
          && event.environment.cwd.source === 'auto-detected'
          && event.environment.cwd.value
          && !conversationCwd.has(thread.id)
        ) {
          conversationCwd.set(thread.id, event.environment.cwd.value);
        }

        if (
          event.type === 'status'
          && event.status.startsWith('cwd:')
          && !conversationCwd.has(thread.id)
        ) {
          const detectedCwd = event.status.slice(4);
          conversationCwd.set(thread.id, detectedCwd);
        }
      }),
    );

    if (finalResult) {
      await publishConversationArtifacts({
        conversationId: thread.id,
        cwd: runCwd,
        resultText: finalResult,
        channel: thread,
        sourceMessageId: triggerMsg?.id,
      });
    }

    if (phase !== 'error' && triggerMsg && options.setReaction) {
      await options.setReaction(triggerMsg, 'done', phase);
    }

    conversationSessions.set(thread.id, resolvedSessionId);
    void (options.persist ?? persistState)();
    return true;
  } finally {
    activeConversations.delete(thread.id);
  }
}
