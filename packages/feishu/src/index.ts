import { fileURLToPath } from 'node:url';
import {
  EventDispatcher,
  LoggerLevel,
  WSClient,
} from '@larksuiteoapi/node-sdk';
import {
  applyFeishuConfigEnvironment,
  readFeishuConfig,
  type FeishuConfig,
} from './config';
import { createFeishuClient } from './api';
import {
  buildFeishuLongConnectionEventHandlers,
  createFeishuEventRouter,
} from './events';

export { readFeishuConfig } from './config';
export type { FeishuConfig } from './config';
export { resolveFeishuSessionChatStateFile } from './config';
export { createFeishuClient } from './api';
export {
  buildFeishuSessionReferenceText,
  launchFeishuSessionFromPrivateChat,
} from './launcher';
export type {
  FeishuLaunchResult,
  FeishuLauncherClient,
} from './launcher';
export {
  beginFeishuDispatch,
  consumeMirroredFeishuMessageId,
  markFeishuDispatchMessageEmitted,
  rememberMirroredFeishuMessageId,
  resetFeishuLaunchStateForTests,
} from './launch-state';
export type { FeishuDispatchMessageKind } from './launch-state';
export {
  buildFeishuSessionChatName,
  normalizeFeishuSessionPromptPreview,
} from './naming';
export {
  buildModelSelectionCard,
  buildSessionAnchorCard,
  buildSessionControlCard,
  createBackendConfirmationCard,
  createBackendSelectionCard,
} from './cards';
export type {
  BackendConfirmationCard,
  BackendSelectionCard,
  FeishuCardContext,
  ModelSelectionCard,
  SessionAnchorCard,
} from './cards';
export {
  buildFeishuBackendConfirmationCardPayload,
  buildFeishuBackendSelectionCardPayload,
  buildFeishuModelSelectionCardPayload,
  buildFeishuSessionAnchorCardPayload,
  buildFeishuSessionControlCardPayload,
} from './cards';
export {
  extractFeishuAttachmentInfos,
  extractFeishuFileInfo,
  extractFeishuMessageText,
  normalizeFeishuEvent,
  resolveConversationId,
  resolveConversationIdFromAction,
  shouldProcessFeishuMessage,
} from './conversation';
export type { FeishuAttachmentInfo, FeishuRawEvent, NormalizedFeishuEvent } from './conversation';
export {
  buildFeishuLongConnectionEventHandlers,
  createFeishuEventRouter,
  FEISHU_CARD_ACTION_EVENT_TYPE,
  FEISHU_MENU_ACTION_EVENT_TYPE,
  FEISHU_MESSAGE_EVENT_TYPE,
  normalizeFeishuCardActionTriggerEvent,
  normalizeFeishuMenuActionTriggerEvent,
  normalizeFeishuMessageReceiveEvent,
} from './events';
export type {
  FeishuCardActionTriggerEvent,
  FeishuMenuActionTriggerEvent,
  FeishuMessageReceiveEvent,
} from './events';
export {
  beginFeishuConversationRun,
  buildFeishuCardContext,
  buildSessionControlCard as buildSessionControlCardFromRuntime,
  confirmBackendChange,
  dispatchFeishuCardAction,
  handleFeishuControlAction,
  isFeishuDoneCommand,
  rememberFeishuConversationMode,
  queuePendingFeishuAttachments,
  requestBackendChange,
  resolveFeishuMessageRequest,
  runFeishuConversation,
} from './runtime';
export { ingestFeishuFiles, uploadFeishuArtifacts } from './files';
export type { FeishuFileLike } from './files';
export {
  buildFeishuSessionChatRecord,
  findFeishuSessionChatBySourceMessage,
  getFeishuSessionChat,
  initializeFeishuSessionChats,
  persistFeishuSessionChats,
  rememberFeishuSessionChat,
  resetFeishuSessionChatsForTests,
  resolveFeishuChatSessionKind,
} from './session-chat';
export type {
  FeishuChatSessionKind,
  FeishuSessionChatRecord,
} from './session-chat';

export type FeishuRuntimeConnection = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

export interface FeishuRuntime {
  readonly started: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}

function isMainModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return fileURLToPath(import.meta.url) === process.argv[1];
}

type FeishuRuntimeDependencies = {
  createConnection?: (config: FeishuConfig) => FeishuRuntimeConnection;
};

function createDefaultConnection(config: FeishuConfig): FeishuRuntimeConnection {
  const router = createFeishuEventRouter(config, {
    client: createFeishuClient(config),
  });
  const eventDispatcher = new EventDispatcher({
    verificationToken: config.feishuVerificationToken,
    encryptKey: config.feishuEncryptKey,
    loggerLevel: LoggerLevel.info,
  }).register(buildFeishuLongConnectionEventHandlers(router));
  const wsClient = new WSClient({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    loggerLevel: LoggerLevel.info,
  });

  return {
    async start(): Promise<void> {
      await wsClient.start({
        eventDispatcher,
      });
    },
    async stop(): Promise<void> {
      wsClient.close({
        force: true,
      });
    },
  };
}

export function createFeishuRuntime(
  config: FeishuConfig = readFeishuConfig(),
  dependencies: FeishuRuntimeDependencies = {},
): FeishuRuntime {
  applyFeishuConfigEnvironment(config);
  const createConnection = dependencies.createConnection ?? createDefaultConnection;
  let connection: FeishuRuntimeConnection | null = null;
  let started = false;

  return {
    get started(): boolean {
      return started;
    },
    async start(): Promise<void> {
      if (started) {
        return;
      }

      connection = createConnection(config);
      await connection.start();
      started = true;
    },
    async stop(): Promise<void> {
      if (!connection) {
        return;
      }

      const currentConnection = connection;
      connection = null;
      await currentConnection.stop();
      started = false;
    },
  };
}

export async function startFeishuRuntime(): Promise<FeishuRuntime> {
  const runtime = createFeishuRuntime();
  await runtime.start();
  return runtime;
}

if (isMainModule()) {
  void startFeishuRuntime().catch((error) => {
    console.error('[feishu] failed to start:', error);
    process.exitCode = 1;
  });
}
