import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createFeishuClient } from './api.js';
import {
  readFeishuConfig,
  type FeishuConfig,
} from './config.js';
import { createFeishuCallbackHandler } from './server.js';

export { readFeishuConfig } from './config.js';
export type { FeishuConfig } from './config.js';
export { createFeishuClient } from './api.js';
export {
  buildSessionControlCard,
  createBackendConfirmationCard,
  createBackendSelectionCard,
} from './cards.js';
export type {
  BackendConfirmationCard,
  BackendSelectionCard,
  FeishuCardContext,
} from './cards.js';
export {
  buildFeishuBackendConfirmationCardPayload,
  buildFeishuBackendSelectionCardPayload,
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
  beginFeishuConversationRun,
  buildFeishuCardContext,
  buildSessionControlCard as buildSessionControlCardFromRuntime,
  confirmBackendChange,
  dispatchFeishuCardAction,
  handleFeishuControlAction,
  rememberFeishuConversationMode,
  queuePendingFeishuAttachments,
  requestBackendChange,
  resolveFeishuMessageRequest,
  runFeishuConversation,
} from './runtime.js';
export { ingestFeishuFiles, uploadFeishuArtifacts } from './files.js';
export type { FeishuFileLike } from './files.js';
export {
  createFeishuSignature,
  handleFeishuCallback,
  parseFeishuCallbackPayload,
  unwrapFeishuCallbackBody,
  validateFeishuSignature,
} from './security.js';
export { createFeishuCallbackHandler } from './server.js';
export type { FeishuCallbackResponse } from './server.js';

export interface FeishuServer {
  readonly started: boolean;
  readonly port: number | null;
  readonly baseUrl: string | null;
  start(): Promise<void>;
  stop(): Promise<void>;
}

function isMainModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return fileURLToPath(import.meta.url) === process.argv[1];
}

export function createFeishuServer(config?: FeishuConfig): FeishuServer {
  let server: Server | null = null;
  let started = false;
  let port: number | null = null;

  return {
    get started(): boolean {
      return started;
    },
    get port(): number | null {
      return port;
    },
    get baseUrl(): string | null {
      return port === null ? null : `http://127.0.0.1:${port}`;
    },
    async start(): Promise<void> {
      if (started) {
        return;
      }

      const resolvedConfig = config ?? readFeishuConfig();
      const handler = createFeishuCallbackHandler(resolvedConfig, {
        client: createFeishuClient(resolvedConfig),
      });
      server = createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }

        const handled = await handler({
          method: request.method ?? 'GET',
          url: request.url ?? '/',
          headers: request.headers as Record<string, string | undefined>,
          body: Buffer.concat(chunks).toString('utf-8'),
        });

        response.writeHead(handled.status, handled.headers);
        response.end(handled.body);
      });

      await new Promise<void>((resolve, reject) => {
        const currentServer = server!;
        const handleError = (error: Error) => {
          currentServer.off('listening', handleListening);
          reject(error);
        };
        const handleListening = () => {
          currentServer.off('error', handleError);
          const address = currentServer.address();
          if (!address || typeof address === 'string') {
            reject(new Error('Feishu server did not expose a TCP port.'));
            return;
          }

          port = address.port;
          started = true;
          console.log(`[feishu] listening on ${address.address}:${address.port}`);
          resolve();
        };

        currentServer.once('error', handleError);
        currentServer.once('listening', handleListening);
        currentServer.listen(resolvedConfig.feishuPort, '0.0.0.0');
      });
    },
    async stop(): Promise<void> {
      if (!server) {
        return;
      }

      const currentServer = server;
      server = null;
      await new Promise<void>((resolve, reject) => {
        currentServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      started = false;
      port = null;
    },
  };
}

export async function startFeishuServer(): Promise<FeishuServer> {
  const server = createFeishuServer();
  await server.start();
  return server;
}

export async function startFeishuRuntime(): Promise<FeishuServer> {
  return startFeishuServer();
}

if (isMainModule()) {
  void startFeishuRuntime().catch((error) => {
    console.error('[feishu] failed to start:', error);
    process.exitCode = 1;
  });
}
