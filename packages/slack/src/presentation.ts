export type SlackReactionPhase = 'received' | 'thinking' | 'tool_running' | 'done' | 'error';

export type SlackReactionTarget = {
  channelId: string;
  messageTs: string;
};

export type SlackReactionTransport = {
  addReaction(reaction: string, target: SlackReactionTarget): Promise<void>;
  removeReaction(reaction: string, target: SlackReactionTarget): Promise<void>;
};

export const SLACK_REACTIONS: Record<SlackReactionPhase, string> = {
  received: 'eyes',
  thinking: 'brain',
  tool_running: 'hammer_and_wrench',
  done: 'white_check_mark',
  error: 'x',
};

export async function applySlackReaction(
  transport: SlackReactionTransport,
  target: SlackReactionTarget,
  phase: SlackReactionPhase,
  previousPhase?: SlackReactionPhase,
): Promise<void> {
  try {
    if (previousPhase && previousPhase !== phase) {
      await transport.removeReaction(SLACK_REACTIONS[previousPhase], target);
    }

    await transport.addReaction(SLACK_REACTIONS[phase], target);
  } catch {
    // Ignore reaction failures so they do not block the user flow.
  }
}
