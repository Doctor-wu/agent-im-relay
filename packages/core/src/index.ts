// Types
export type {
  ConversationId,
  MessageId,
  AgentStatus,
  IncomingMessage,
  FormattedContent,
  CommandArgChoice,
  CommandArg,
  CommandDefinition,
  CommandInvocation,
  SelectMenuOption,
  SelectMenuOptions,
  PromptInputOptions,
  MessageSender,
  ConversationManager,
  StatusIndicator,
  CommandRegistry,
  InteractiveUI,
  MarkdownFormatter,
  PlatformAdapter,
} from './types.js';

// Orchestrator
export { Orchestrator } from './orchestrator.js';
export type { AgentSessionFactory, OrchestratorOptions } from './orchestrator.js';

// Agent
export { buildAgentPrompt, streamAgentSession, extractEvents, createClaudeArgs } from './agent/session.js';
export { runConversationSession, interruptConversationRun, isConversationRunning, resetConversationRuntimeForTests } from './agent/runtime.js';
export type { AgentEnvironment, AgentStreamEvent, AgentSessionOptions } from './agent/session.js';
export {
  getAvailableBackendCapabilities,
  getAvailableBackendNames,
  getAvailableBackends,
  getBackend,
  getBackendSupportedModels,
  getRegisteredBackendNames,
  isBackendCommandAvailable,
  isBackendModelSupported,
  isRegisteredBackendName,
  resolveBackendModelId,
  registerBackend,
  resetBackendRegistryForTests,
} from './agent/backend.js';
export type {
  AgentBackend,
  AgentBackendCapability,
  BackendModel,
  BackendName,
} from './agent/backend.js';
export { toolsForMode } from './agent/tools.js';
export type { AgentMode } from './agent/tools.js';
export { runConversationWithRenderer } from './runtime/conversation-runner.js';
export type { ConversationRunPhase } from './runtime/conversation-runner.js';
export {
  applyConversationControlAction,
  applyMessageControlDirectives,
  evaluateConversationRunRequest,
  preprocessConversationMessage,
  runPlatformConversation,
} from './platform/conversation.js';
export type {
  ConversationControlAction,
  ConversationControlResult,
  ConversationRunEvaluation,
} from './platform/conversation.js';
export type {
  MessageControlDirective,
  PreprocessedConversationMessage,
} from './platform/message-preprocessing.js';
export { applySessionControlCommand } from './session-control/controller.js';
export type { SessionControlCommand, SessionControlResult } from './session-control/types.js';
export {
  buildAttachmentPromptContext,
  downloadIncomingAttachments,
  prepareAttachmentPrompt,
  stageOutgoingArtifacts,
} from './runtime/files.js';
export type { DownloadedAttachment, RemoteAttachmentLike, StagedArtifactsResult } from './runtime/files.js';
export type {
  ClientHeartbeatEvent,
  ClientHelloEvent,
  ClientToGatewayEvent,
  ConversationCardEvent,
  ConversationControlCommand,
  ConversationDoneEvent,
  ConversationErrorEvent,
  ConversationFileCommand,
  ConversationFileEvent,
  ConversationRunCommand,
  ConversationTextEvent,
  GatewayToClientCommand,
  ManagedBridgeTarget,
} from './bridge/protocol.js';

// State
export {
  conversationSessions,
  conversationModels,
  conversationEffort,
  conversationCwd,
  conversationBackend,
  conversationMode,
  conversationArtifacts,
  threadSessionBindings,
  threadContinuationSnapshots,
  savedCwdList,
  activeConversations,
  processedMessages,
  processedEventIds,
  pendingConversationCreation,
  pendingBackendChanges,
  getConversationArtifactMetadata,
  initState,
  persistConversationArtifactMetadata,
  persistState,
} from './state.js';
export {
  closeThreadSession,
  confirmThreadSessionBinding,
  invalidateThreadSessionBinding,
  openThreadSessionBinding,
  resolveThreadResumeMode,
  updateThreadContinuationSnapshot,
} from './thread-session/manager.js';
export type {
  ThreadContinuationSnapshot,
  ThreadContinuationStopReason,
  ThreadNativeSessionStatus,
  ThreadResumeMode,
  ThreadSessionBinding,
} from './thread-session/types.js';

// Artifacts
export {
  createEmptyArtifactMetadata,
  cloneConversationArtifactMetadata,
  ensureConversationArtifactPaths,
  getConversationArtifactPaths,
  readArtifactMetadata,
  writeArtifactMetadata,
} from './artifacts/store.js';
export {
  parseArtifactManifest,
  resolveArtifactCandidatePaths,
  resolveArtifactPath,
  stripArtifactManifest,
} from './artifacts/protocol.js';
export type {
  ArtifactKind,
  ArtifactRecord,
  ArtifactManifest,
  ArtifactManifestFile,
  ConversationArtifactMetadata,
  ConversationArtifactPaths,
} from './artifacts/types.js';

// Skills
export { listSkills, refreshSkills, readSkillsFromDirectory, parseSkillFrontmatter } from './skills.js';
export type { SkillInfo } from './skills.js';

// Config
export { config } from './config.js';
export { readCoreConfig } from './config.js';
export { applyCoreConfigEnvironment } from './config.js';
export type { CoreConfig } from './config.js';
export { resolveRelayHomeDir, resolveRelayPaths } from './paths.js';
export type { RelayPaths } from './paths.js';
export { relayPlatforms, isRelayPlatform, inferRelayPlatformFromConversationId } from './relay-platform.js';
export type { RelayPlatform } from './relay-platform.js';
