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
} from './config.js';
import { createFeishuClient } from './api.js';
import {
  buildFeishuLongConnectionEventHandlers,
  createFeishuEventRouter,
} from './events.js';

export { readFeishuConfig } from './config.js';
export type { FeishuConfig } from './config.js';
export { resolveFeishuSessionChatStateFile } from './config.js';
export { createFeishuClient } from './api.js';
export {
  buildSessionAnchorCard,
  buildSessionControlCard,
  createBackendConfirmationCard,
  createBackendSelectionCard,
} from './cards.js';
export type {
  BackendConfirmationCard,
  BackendSelectionCard,
  FeishuCardContext,
  SessionAnchorCard,
} from './cards.js';
export {
  buildFeishuBackendConfirmationCardPayload,
  buildFeishuBackendSelectionCardPayload,
  buildFeishuSessionAnchorCardPayload,
  buildFeishuSessionControlCardPayload,
} from './cards.js';
export {
  extractFeishuFileInfo,
  extractFeishuMessageText,
  normalizeFeishuEvent,
  resolveConversationId,
  resolveConversationIdFromAction,
  shouldProcessFeishuMessage,
} from './conversation.js';
export type { FeishuRawEvent, NormalizedFeishuEvent } from './conversation.js';
export {
  buildFeishuLongConnectionEventHandlers,
  createFeishuEventRouter,
  FEISHU_CARD_ACTION_EVENT_TYPE,
  FEISHU_MENU_ACTION_EVENT_TYPE,
  FEISHU_MESSAGE_EVENT_TYPE,
  normalizeFeishuCardActionTriggerEvent,
  normalizeFeishuMenuActionTriggerEvent,
  normalizeFeishuMessageReceiveEvent,
} from './events.js';
export type {
  FeishuCardActionTriggerEvent,
  FeishuMenuActionTriggerEvent,
  FeishuMessageReceiveEvent,
} from './events.js';
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
} from './runtime.js';
export { ingestFeishuFiles, uploadFeishuArtifacts } from './files.js';
export type { FeishuFileLike } from './files.js';
export {
  buildFeishuSessionChatRecord,
  findFeishuSessionChatBySourceMessage,
  getFeishuSessionChat,
  initializeFeishuSessionChats,
  persistFeishuSessionChats,
  rememberFeishuSessionChat,
  resetFeishuSessionChatsForTests,
  resolveFeishuChatSessionKind,
  updateFeishuSessionChat,
} from './session-chat.js';
export type {
  FeishuChatSessionKind,
  FeishuSessionChatRecord,
  FeishuSessionChatUpdate,
} from './session-chat.js';

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
