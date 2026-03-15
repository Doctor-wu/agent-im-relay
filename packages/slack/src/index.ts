import { isSlackRuntimeMainModule, startSlackRuntime } from './runtime';

export { readSlackConfig, applySlackConfigEnvironment, resolveSlackConversationStateFile, resolveSlackPendingRunStateFile } from './config';
export type { SlackConfig } from './config';
export { buildSlackBackendSelectionBlocks, buildSlackModelSelectionBlocks } from './cards';
export type { SlackBackendSelectionCard, SlackModelSelectionCard, SlackBlock } from './cards';
export { convertMarkdownToSlackMrkdwn } from './formatting';
export { applySlackReaction, SLACK_REACTIONS } from './presentation';
export type { SlackReactionPhase, SlackReactionTarget, SlackReactionTransport } from './presentation';
export { streamSlackMessages } from './stream';
export { createSlackAdapter } from './adapter';
export type { SlackAdapterOptions, SlackTransport } from './adapter';
export { buildSlackConversationId, resolveSlackConversationIdForMessage, shouldProcessSlackMessage } from './conversation';
export type { SlackMessageEvent } from './conversation';
export { parseSlackCodeCommand } from './commands/code';
export { parseSlackAskCommand } from './commands/ask';
export { resolveSlackInterruptTarget } from './commands/interrupt';
export { resolveSlackDoneTarget } from './commands/done';
export { parseSlackSkillCommand } from './commands/skill';
export {
  consumeSlackTriggerContext,
  findSlackConversationByThreadTs,
  getSlackConversation,
  loadSlackConversationState,
  persistSlackConversationState,
  registerSlackTriggerContext,
  rememberSlackConversation,
  resolveSlackInteractiveValue,
  resetSlackStateForTests,
  updateSlackStatusMessageTs,
  waitForSlackInteractiveValue,
} from './state';
export type { SlackConversationRecord, SlackTriggerContext } from './state';
export { createSlackBoltTransport, createSlackRuntime, hasPendingSlackRun, isSlackRuntimeMainModule, resetSlackRuntimeForTests, startSlackRuntime } from './runtime';
export type { SlackActionPayload, SlackAppLike, SlackCommandPayload, SlackRuntime, SlackRuntimeOptions, SlackRuntimeTransport } from './runtime';

if (isSlackRuntimeMainModule()) {
  void startSlackRuntime().catch((error) => {
    console.error('[slack] failed to start:', error);
    process.exitCode = 1;
  });
}
