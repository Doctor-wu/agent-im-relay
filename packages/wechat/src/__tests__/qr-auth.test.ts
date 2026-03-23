import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QRCodeData } from '../types';

// We import after mocking so we can replace ilinkFetch in module scope
// The functions take an ilinkFetch parameter directly, making them easy to test.
import { requestQRCode, waitForScan } from '../qr-auth';

describe('requestQRCode', () => {
  it('calls the QR code endpoint and returns QRCodeData', async () => {
    const mockQR: QRCodeData = {
      qrCodeUrl: 'https://ilink.example.com/qr/abc123',
      qrCodeBase64: 'base64encodedimage==',
      expireSeconds: 120,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: mockQR }),
    });

    const result = await requestQRCode(mockFetch);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('qrcode'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual(mockQR);
  });

  it('throws when the API returns a non-ok HTTP status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(requestQRCode(mockFetch)).rejects.toThrow();
  });

  it('throws when the API returns a non-zero code', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 1, message: 'internal error' }),
    });

    await expect(requestQRCode(mockFetch)).rejects.toThrow('internal error');
  });
});

describe('waitForScan', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('returns a session token when the user scans the QR code', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: { status: 'confirmed', sessionToken: 'tok_scanned_xyz' },
      }),
    });

    const token = await waitForScan(mockFetch, 'https://ilink.example.com/qr/abc123');

    expect(token).toBe('tok_scanned_xyz');
  });

  it('polls multiple times until confirmed', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        return {
          ok: true,
          json: async () => ({ code: 0, data: { status: 'pending' } }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          code: 0,
          data: { status: 'confirmed', sessionToken: 'tok_after_polls' },
        }),
      };
    });

    const promise = waitForScan(mockFetch, 'https://ilink.example.com/qr/abc123');

    // Advance timers for the polling intervals
    for (let i = 0; i < 3; i++) {
      await vi.runAllTimersAsync();
    }

    const token = await promise;
    expect(token).toBe('tok_after_polls');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('re-requests a new QR code when the current one expires', async () => {
    let callCount = 0;
    const newQR: QRCodeData = {
      qrCodeUrl: 'https://ilink.example.com/qr/new999',
      expireSeconds: 120,
    };

    // First call: poll returns expired
    // Second call: requestQRCode — returns new QR
    // Third call: poll returns confirmed with token
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      callCount++;
      if (callCount === 1) {
        // First poll — expired
        return {
          ok: true,
          json: async () => ({ code: 0, data: { status: 'expired' } }),
        };
      }
      if (callCount === 2) {
        // Re-request QR code
        return {
          ok: true,
          json: async () => ({ code: 0, data: newQR }),
        };
      }
      // Third poll — confirmed
      return {
        ok: true,
        json: async () => ({
          code: 0,
          data: { status: 'confirmed', sessionToken: 'tok_renewed' },
        }),
      };
    });

    const promise = waitForScan(mockFetch, 'https://ilink.example.com/qr/abc123');

    for (let i = 0; i < 5; i++) {
      await vi.runAllTimersAsync();
    }

    const token = await promise;
    expect(token).toBe('tok_renewed');
    // The QR was re-fetched (callCount should be 3: poll, re-qr, poll)
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('throws when the QR scan times out', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { status: 'pending' } }),
    });

    const promise = waitForScan(
      mockFetch,
      'https://ilink.example.com/qr/abc123',
      { timeoutMs: 5_000, pollIntervalMs: 2_000 },
    );
    // Prevent unhandled rejection during timer advancement
    promise.catch(() => {});

    // Advance past the timeout
    await vi.advanceTimersByTimeAsync(6_000);

    await expect(promise).rejects.toThrow(/timeout/i);
  });
});
