import type { QRCodeData } from './types';

const ILINK_BASE_URL = 'https://api.ilink.bot/v1';

export type ILinkFetch = (url: string, init?: RequestInit) => Promise<Response>;

interface ILinkResponse<T = unknown> {
  code: number;
  message?: string;
  data?: T;
}

async function parseILinkResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`iLink API HTTP ${response.status}`);
  }

  const body = (await response.json()) as ILinkResponse<T>;
  if (body.code !== 0) {
    throw new Error(body.message ?? `iLink API error code ${body.code}`);
  }

  return body.data as T;
}

export async function requestQRCode(fetch: ILinkFetch): Promise<QRCodeData> {
  const response = await fetch(`${ILINK_BASE_URL}/auth/qrcode`, { method: 'GET' });
  return parseILinkResponse<QRCodeData>(response);
}

export interface WaitForScanOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

interface ScanPollResult {
  status: 'pending' | 'confirmed' | 'expired';
  sessionToken?: string;
}

export async function waitForScan(
  fetch: ILinkFetch,
  qrCodeUrl: string,
  options: WaitForScanOptions = {},
): Promise<string> {
  const { timeoutMs = 120_000, pollIntervalMs = 2_000 } = options;
  const deadline = Date.now() + timeoutMs;
  let currentQrUrl = qrCodeUrl;

  while (Date.now() < deadline) {
    const response = await fetch(
      `${ILINK_BASE_URL}/auth/scan-status?qrUrl=${encodeURIComponent(currentQrUrl)}`,
      { method: 'GET' },
    );

    const result = await parseILinkResponse<ScanPollResult>(response);

    if (result.status === 'confirmed' && result.sessionToken) {
      return result.sessionToken;
    }

    if (result.status === 'expired') {
      // Re-request a new QR code
      const newQR = await requestQRCode(fetch);
      currentQrUrl = newQR.qrCodeUrl;
      continue;
    }

    // Still pending — wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error('QR code scan timeout');
}
