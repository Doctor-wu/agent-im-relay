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
} from './types';

// Orchestrator
export { Orchestrator } from './orchestrator';
export type { AgentSessionFactory, OrchestratorOptions } from './orchestrator';

// Agent
export { buildAgentPrompt, streamAgentSession, extractEvents, createClaudeArgs } from './agent/session';
export {
  clearConversationPermissionState,
  getPendingPermissionRequests,
  interruptConversationRun,
  isConversationRunning,
  registerConversationPermissionResponder,
  registerPermissionRequest,
  resetConversationRuntimeForTests,
  resolvePermissionRequest,
  runConversationSession,
} from './agent/runtime';
export { maybeUnrefTimer } from './runtime/timers';
export type { AgentEnvironment, AgentStreamEvent, AgentSessionOptions } from './agent/session';
export type { PendingPermissionRequest } from './agent/runtime';
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
} from './agent/backend';
export type {
  AgentBackend,
  AgentBackendCapability,
  BackendModel,
  BackendName,
} from './agent/backend';
export { toolsForMode } from './agent/tools';
export type { AgentMode } from './agent/tools';
export { runConversationWithRenderer } from './runtime/conversation-runner';
export type { ConversationRunPhase } from './runtime/conversation-runner';
export {
  applyConversationControlAction,
  applyMessageControlDirectives,
  evaluateConversationRunRequest,
  preprocessConversationMessage,
  runPlatformConversation,
} from './platform/conversation';
export type {
  ConversationControlAction,
  ConversationControlResult,
  ConversationRunEvaluation,
} from './platform/conversation';
export type {
  MessageControlDirective,
  PreprocessedConversationMessage,
} from './platform/message-preprocessing';
export { applySessionControlCommand } from './session-control/controller';
export type { SessionControlCommand, SessionControlResult } from './session-control/types';
export {
  buildAttachmentPromptContext,
  downloadIncomingAttachments,
  prepareAttachmentPrompt,
  stageOutgoingArtifacts,
} from './runtime/files';
export type { DownloadedAttachment, RemoteAttachmentLike, StagedArtifactsResult } from './runtime/files';
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
} from './bridge/protocol';

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
} from './state';
export {
  closeThreadSession,
  confirmThreadSessionBinding,
  invalidateThreadSessionBinding,
  openThreadSessionBinding,
  resolveThreadResumeMode,
  updateThreadContinuationSnapshot,
} from './thread-session/manager';
export type {
  ThreadContinuationSnapshot,
  ThreadContinuationStopReason,
  ThreadNativeSessionStatus,
  ThreadResumeMode,
  ThreadSessionBinding,
} from './thread-session/types';

// Artifacts
export {
  createEmptyArtifactMetadata,
  cloneConversationArtifactMetadata,
  ensureConversationArtifactPaths,
  getConversationArtifactPaths,
  readArtifactMetadata,
  writeArtifactMetadata,
} from './artifacts/store';
export {
  parseArtifactManifest,
  resolveArtifactCandidatePaths,
  resolveArtifactPath,
  stripArtifactManifest,
} from './artifacts/protocol';
export type {
  ArtifactKind,
  ArtifactRecord,
  ArtifactManifest,
  ArtifactManifestFile,
  ConversationArtifactMetadata,
  ConversationArtifactPaths,
} from './artifacts/types';

// Skills
export { listSkills, refreshSkills, readSkillsFromDirectory, parseSkillFrontmatter } from './skills';
export type { SkillInfo } from './skills';

// Config
export { config } from './config';
export { readCoreConfig } from './config';
export { applyCoreConfigEnvironment } from './config';
export {
  ensureDefaultRecords,
  loadRelayConfig,
  parseConfigJsonl,
  readDiscordRelayConfig,
  readFeishuRelayConfig,
  readRelayConfig,
  readSlackRelayConfig,
  resolveAvailableIms,
  resolveLastUsedPlatform,
  resolveRuntimeConfig,
  saveRelayConfig,
  serializeConfigRecords,
  upsertRecord,
} from './config';
export type {
  AvailableIm,
  CoreConfig,
  DiscordImConfig,
  DiscordImRecord,
  DiscordRelayConfig,
  FeishuImConfig,
  FeishuImRecord,
  FeishuRelayConfig,
  LocalPreferencesRecord,
  MetaRecord,
  RelayConfigRecord,
  LoadedRelayConfig,
  RuntimeConfig,
  RuntimeRecord,
  SlackImConfig,
  SlackImRecord,
  SlackRelayConfig,
} from './config';
export { resolveRelayHomeDir, resolveRelayPaths, resolveRelayPlatformStateDir } from './paths';
export type { RelayPaths } from './paths';
export { relayPlatforms, isRelayPlatform, inferRelayPlatformFromConversationId } from './relay-platform';
export type { RelayPlatform } from './relay-platform';
