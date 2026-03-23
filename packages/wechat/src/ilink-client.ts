import type { WeChatConfig } from './config';
import type { ILinkClientEvent, ILinkEventHandler, ILinkMessage } from './types';
import { requestQRCode, waitForScan, type ILinkFetch } from './qr-auth';

const ILINK_BASE_URL = 'https://api.ilink.bot/v1';

export class ILinkClient {
  private config: WeChatConfig;
  private fetch: ILinkFetch;
  private handlers: ILinkEventHandler[] = [];
  private running = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private backoffMs = 1_000;
  private sessionToken: string | null;
  private sleepAbort: AbortController | null = null;
  private disconnectReject: ((error: Error) => void) | null = null;
  private disconnectPromise: Promise<never> | null = null;

  constructor(config: WeChatConfig, fetch: ILinkFetch) {
    this.config = config;
    this.fetch = fetch;
    this.sessionToken = config.sessionToken ?? null;
  }

  onEvent(handler: ILinkEventHandler): void {
    this.handlers.push(handler);
  }

  private emit(event: ILinkClientEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  async connect(): Promise<void> {
    this.running = true;
    this.disconnectPromise = new Promise<never>((_, reject) => {
      this.disconnectReject = reject;
    });
    // Prevent unhandled rejection when disconnect races
    this.disconnectPromise.catch(() => {});

    try {
      if (!this.sessionToken) {
        await this.doQRAuth();
      }

      this.emit({ type: 'connected' });
      this.startHeartbeat();
      await this.pollLoop();
    } catch (error) {
      if (this.running) {
        this.emit({ type: 'error', error: error instanceof Error ? error : new Error(String(error)) });
      }
    }
  }

  disconnect(): void {
    this.running = false;
    this.stopHeartbeat();
    this.sleepAbort?.abort();
    this.disconnectReject?.(new Error('disconnected'));
    this.emit({ type: 'disconnected', reason: 'manual' });
  }

  getSessionToken(): string | null {
    return this.sessionToken;
  }

  private async doQRAuth(): Promise<void> {
    const qrData = await requestQRCode(this.fetch);
    this.emit({ type: 'qr_code', data: qrData });
    this.sessionToken = await waitForScan(this.fetch, qrData.qrCodeUrl);
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const response = await Promise.race([
          this.fetch(
            `${ILINK_BASE_URL}/messages/poll?sessionToken=${encodeURIComponent(this.sessionToken!)}`,
            { method: 'GET' },
          ),
          this.disconnectPromise!,
        ]);

        if (!this.running) break;

        const body = await response.json() as {
          code: number;
          data?: { messages: ILinkMessage[]; nextPollMs?: number };
        };

        if (body.code === 0 && body.data?.messages) {
          for (const msg of body.data.messages) {
            this.emit({ type: 'message', data: msg });
          }
        }

        this.backoffMs = 1_000;
      } catch (error) {
        if (!this.running) break;

        this.emit({
          type: 'disconnected',
          reason: error instanceof Error ? error.message : String(error),
        });

        await this.sleep(this.backoffMs);
        if (!this.running) break;
        this.backoffMs = Math.min(this.backoffMs * 2, this.config.reconnectMaxDelayMs);
      }
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.running || !this.sessionToken) return;
      this.fetch(
        `${ILINK_BASE_URL}/heartbeat?sessionToken=${encodeURIComponent(this.sessionToken)}`,
        { method: 'POST' },
      ).catch(() => {});
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sleepAbort = new AbortController();
      const timer = setTimeout(resolve, ms);
      this.sleepAbort.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
