import { readFile } from 'node:fs/promises';
import type {
  ClientHeartbeatEvent,
  ClientHelloEvent,
  ClientToGatewayEvent,
  GatewayToClientCommand,
} from '@agent-im-relay/core';
import { buildFeishuBackendConfirmationCardPayload } from './cards.js';
import { buildFeishuCardContext } from './runtime.js';
import { handleFeishuControlAction, runFeishuConversation, type FeishuRuntimeTransport } from './runtime.js';
import type { FeishuRelayClientConfig } from './config.js';

type FetchLike = typeof fetch;

type ManagedRelayClientOptions = {
  fetchImpl?: FetchLike;
  now?: () => string;
  readFileImpl?: typeof readFile;
  sleep?: (ms: number) => Promise<void>;
};

function buildBridgeUrl(baseUrl: string, pathname: string): string {
  return new URL(pathname, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

async function readBridgeResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Managed Feishu gateway request failed with HTTP ${response.status}.`);
  }

  return JSON.parse(await response.text()) as T;
}

export function buildManagedClientHelloEvent(
  config: FeishuRelayClientConfig,
  now: () => string = () => new Date().toISOString(),
): ClientHelloEvent {
  return {
    type: 'client.hello',
    clientId: config.feishuClientId,
    requestId: `${config.feishuClientId}:hello`,
    timestamp: now(),
    payload: {
      token: config.feishuClientToken,
    },
  };
}

export function buildManagedClientHeartbeatEvent(
  config: FeishuRelayClientConfig,
  now: () => string = () => new Date().toISOString(),
): ClientHeartbeatEvent {
  return {
    type: 'client.heartbeat',
    clientId: config.feishuClientId,
    requestId: `${config.feishuClientId}:heartbeat`,
    timestamp: now(),
    payload: {
      token: config.feishuClientToken,
    },
  };
}

export function createManagedFeishuRelayClient(
  config: FeishuRelayClientConfig,
  options: ManagedRelayClientOptions = {},
) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const readFileImpl = options.readFileImpl ?? readFile;
  const sleep = options.sleep ?? (async (ms: number) => {
    await new Promise(resolve => setTimeout(resolve, ms));
  });
  let stopped = false;

  if (!fetchImpl) {
    throw new Error('Fetch is not available.');
  }

  async function post(pathname: string, payload: Record<string, unknown>): Promise<Response> {
    return fetchImpl(buildBridgeUrl(config.feishuGatewayUrl, pathname), {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });
  }

  async function sendEvent(event: ClientToGatewayEvent): Promise<void> {
    await readBridgeResponse(await post('/feishu/bridge/events', {
      clientId: config.feishuClientId,
      token: config.feishuClientToken,
      event,
    }));
  }

  function createBridgeTransport(command: GatewayToClientCommand): FeishuRuntimeTransport {
    return {
      async sendText(_target, text): Promise<void> {
        await sendEvent({
          type: 'conversation.text',
          clientId: config.feishuClientId,
          requestId: command.requestId,
          conversationId: command.conversationId ?? '',
          timestamp: now(),
          payload: {
            text,
          },
        });
      },
      async sendCard(_target, card): Promise<void> {
        await sendEvent({
          type: 'conversation.card',
          clientId: config.feishuClientId,
          requestId: command.requestId,
          conversationId: command.conversationId ?? '',
          timestamp: now(),
          payload: {
            card,
          },
        });
      },
      async uploadFile(_target, filePath): Promise<void> {
        const buffer = await readFileImpl(filePath);
        await sendEvent({
          type: 'conversation.file',
          clientId: config.feishuClientId,
          requestId: command.requestId,
          conversationId: command.conversationId ?? '',
          timestamp: now(),
          payload: {
            fileName: filePath.split('/').pop() ?? 'artifact',
            data: buffer.toString('base64'),
          },
        });
      },
    };
  }

  async function finalizeCommand(command: GatewayToClientCommand, status: 'completed' | 'failed' | 'started' | 'blocked' | 'busy') {
    await sendEvent({
      type: 'conversation.done',
      clientId: config.feishuClientId,
      requestId: command.requestId,
      conversationId: command.conversationId ?? '',
      timestamp: now(),
      payload: {
        status,
      },
    });
  }

  return {
    async sendHello(): Promise<ClientHelloEvent> {
      const event = buildManagedClientHelloEvent(config, now);
      await readBridgeResponse(await post('/feishu/bridge/hello', {
        clientId: config.feishuClientId,
        token: config.feishuClientToken,
      }));
      return event;
    },

    async sendHeartbeat(): Promise<ClientHeartbeatEvent> {
      const event = buildManagedClientHeartbeatEvent(config, now);
      await readBridgeResponse(await post('/feishu/bridge/heartbeat', {
        clientId: config.feishuClientId,
        token: config.feishuClientToken,
      }));
      return event;
    },

    async pollCommands(limit = 1): Promise<GatewayToClientCommand[]> {
      const response = await readBridgeResponse<{ commands?: GatewayToClientCommand[] }>(await post('/feishu/bridge/pull', {
        clientId: config.feishuClientId,
        token: config.feishuClientToken,
        limit,
      }));
      return response.commands ?? [];
    },

    async handleCommand(command: GatewayToClientCommand): Promise<void> {
      const transport = createBridgeTransport(command);

      try {
        if (command.type === 'conversation.run') {
          const result = await runFeishuConversation({
            conversationId: command.conversationId,
            target: command.payload.target,
            prompt: command.payload.prompt,
            mode: command.payload.mode,
            transport,
            defaultCwd: config.claudeCwd,
            sourceMessageId: command.payload.sourceMessageId,
            attachments: command.payload.attachments,
          });
          await finalizeCommand(command, result.kind === 'started' ? 'completed' : result.kind);
          return;
        }

        if (command.type === 'conversation.control') {
          const result = await handleFeishuControlAction({
            action: command.payload.action,
            target: command.payload.target,
            transport,
          });

          if (result.kind === 'backend-confirmation') {
            await transport.sendCard(
              command.payload.target,
              buildFeishuBackendConfirmationCardPayload(
                result.card,
                buildFeishuCardContext(command.conversationId, command.payload.target),
              ),
            );
            await finalizeCommand(command, 'completed');
            return;
          }

          await finalizeCommand(command, 'completed');
          return;
        }

        await finalizeCommand(command, 'completed');
      } catch (error) {
        await sendEvent({
          type: 'conversation.error',
          clientId: config.feishuClientId,
          requestId: command.requestId,
          conversationId: command.conversationId ?? '',
          timestamp: now(),
          payload: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
        await finalizeCommand(command, 'failed');
      }
    },

    async pollOnce(limit = 1): Promise<number> {
      const commands = await this.pollCommands(limit);
      for (const command of commands) {
        await this.handleCommand(command);
      }
      return commands.length;
    },

    async start(): Promise<void> {
      stopped = false;
      await this.sendHello();

      while (!stopped) {
        await this.sendHeartbeat();
        await this.pollOnce();
        if (!stopped) {
          await sleep(config.feishuClientPollIntervalMs);
        }
      }
    },

    stop(): void {
      stopped = true;
    },
  };
}
