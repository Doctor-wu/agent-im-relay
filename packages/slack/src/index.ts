import { isSlackRuntimeMainModule, startSlackRuntime } from './runtime.js';

export { readSlackConfig, applySlackConfigEnvironment, resolveSlackConversationStateFile, resolveSlackPendingRunStateFile } from './config.js';
export type { SlackConfig } from './config.js';
export { buildSlackBackendSelectionBlocks, buildSlackModelSelectionBlocks } from './cards.js';
export type { SlackBackendSelectionCard, SlackModelSelectionCard, SlackBlock } from './cards.js';
export { convertMarkdownToSlackMrkdwn } from './formatting.js';
export { createSlackAdapter } from './adapter.js';
export type { SlackAdapterOptions, SlackTransport } from './adapter.js';
export { buildSlackConversationId, resolveSlackConversationIdForMessage, shouldProcessSlackMessage } from './conversation.js';
export type { SlackMessageEvent } from './conversation.js';
export { parseSlackCodeCommand } from './commands/code.js';
export { parseSlackAskCommand } from './commands/ask.js';
export { resolveSlackInterruptTarget } from './commands/interrupt.js';
export { resolveSlackDoneTarget } from './commands/done.js';
export { parseSlackSkillCommand } from './commands/skill.js';
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
} from './state.js';
export type { SlackConversationRecord, SlackTriggerContext } from './state.js';
export { createSlackBoltTransport, createSlackRuntime, hasPendingSlackRun, isSlackRuntimeMainModule, resetSlackRuntimeForTests, startSlackRuntime } from './runtime.js';
export type { SlackActionPayload, SlackAppLike, SlackCommandPayload, SlackRuntime, SlackRuntimeOptions, SlackRuntimeTransport } from './runtime.js';

if (isSlackRuntimeMainModule()) {
  void startSlackRuntime().catch((error) => {
    console.error('[slack] failed to start:', error);
    process.exitCode = 1;
  });
}
