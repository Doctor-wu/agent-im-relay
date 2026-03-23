import { describe, it, expect, vi } from 'vitest';
import { downloadMedia, uploadMedia, MAX_MEDIA_SIZE } from '../media';

function createMockFetch(responses: Array<{ ok: boolean; body?: unknown; arrayBuffer?: ArrayBuffer }>) {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return {
      ok: resp.ok,
      status: resp.ok ? 200 : 500,
      json: async () => resp.body ?? {},
      arrayBuffer: async () => resp.arrayBuffer ?? new ArrayBuffer(0),
      headers: new Headers({ 'content-type': 'image/jpeg' }),
    } as unknown as Response;
  });
}

describe('downloadMedia', () => {
  it('downloads media from iLink API and returns buffer with metadata', async () => {
    const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    const mockFetch = createMockFetch([
      { ok: true, arrayBuffer: imageData },
    ]);

    const result = await downloadMedia(mockFetch, 'https://ilink.bot/media/img.jpg', 'tok_session');

    expect(result).toBeDefined();
    expect(result!.data.byteLength).toBe(4);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('returns null on download failure', async () => {
    const mockFetch = createMockFetch([
      { ok: false },
    ]);

    const result = await downloadMedia(mockFetch, 'https://ilink.bot/media/fail.jpg', 'tok_session');

    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network error'));

    const result = await downloadMedia(mockFetch, 'https://ilink.bot/media/err.jpg', 'tok_session');

    expect(result).toBeNull();
  });
});

describe('uploadMedia', () => {
  it('uploads media and returns mediaId', async () => {
    const mockFetch = createMockFetch([
      { ok: true, body: { code: 0, data: { mediaId: 'media_uploaded_001' } } },
    ]);

    const data = new Uint8Array([1, 2, 3, 4]);
    const result = await uploadMedia(mockFetch, data, 'image.jpg', 'image/jpeg', 'tok_session');

    expect(result).toBe('media_uploaded_001');
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/media/upload');
  });

  it('rejects files exceeding 100MB', async () => {
    const mockFetch = vi.fn();

    const bigData = new Uint8Array(MAX_MEDIA_SIZE + 1);
    const result = await uploadMedia(mockFetch, bigData, 'big.bin', 'application/octet-stream', 'tok_session');

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null on upload failure', async () => {
    const mockFetch = createMockFetch([
      { ok: false, body: {} },
    ]);

    const data = new Uint8Array([1, 2, 3]);
    const result = await uploadMedia(mockFetch, data, 'file.bin', 'application/octet-stream', 'tok_session');

    expect(result).toBeNull();
  });

  it('returns null when API returns non-zero code', async () => {
    const mockFetch = createMockFetch([
      { ok: true, body: { code: -1, message: 'upload failed' } },
    ]);

    const data = new Uint8Array([1, 2, 3]);
    const result = await uploadMedia(mockFetch, data, 'file.bin', 'application/octet-stream', 'tok_session');

    expect(result).toBeNull();
  });

  it('handles supported image types', async () => {
    const mockFetch = createMockFetch([
      { ok: true, body: { code: 0, data: { mediaId: 'media_png' } } },
    ]);

    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const result = await uploadMedia(mockFetch, data, 'pic.png', 'image/png', 'tok_session');

    expect(result).toBe('media_png');
  });
});
