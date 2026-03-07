export { readFeishuConfig } from './config.js';
export type { FeishuConfig } from './config.js';
export {
  buildSessionControlCard,
  createBackendConfirmationCard,
  createBackendSelectionCard,
} from './cards.js';
export type {
  BackendConfirmationCard,
  BackendSelectionCard,
} from './cards.js';
export {
  normalizeFeishuEvent,
  resolveConversationId,
  resolveConversationIdFromAction,
} from './conversation.js';
export type { FeishuRawEvent, NormalizedFeishuEvent } from './conversation.js';
export {
  beginFeishuConversationRun,
  buildSessionControlCard as buildSessionControlCardFromRuntime,
  confirmBackendChange,
  dispatchFeishuCardAction,
  rememberFeishuConversationMode,
  requestBackendChange,
  resolveFeishuMessageRequest,
} from './runtime.js';
export { ingestFeishuFiles, uploadFeishuArtifacts } from './files.js';
export type { FeishuFileLike } from './files.js';
export {
  createFeishuSignature,
  handleFeishuCallback,
  parseFeishuCallbackPayload,
  validateFeishuSignature,
} from './security.js';

export interface FeishuServer {
  readonly started: false;
  start(): Promise<void>;
}

export function createFeishuServer(): FeishuServer {
  return {
    started: false,
    async start(): Promise<void> {
      throw new Error('Feishu server startup is not implemented yet.');
    },
  };
}

export async function startFeishuServer(): Promise<FeishuServer> {
  const server = createFeishuServer();
  await server.start();
  return server;
}
