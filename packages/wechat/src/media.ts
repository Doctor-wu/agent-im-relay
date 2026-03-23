import type { ILinkFetch } from './qr-auth';

const ILINK_BASE_URL = 'https://api.ilink.bot/v1';

export const MAX_MEDIA_SIZE = 100 * 1024 * 1024; // 100MB

export interface DownloadedMedia {
  data: ArrayBuffer;
  contentType: string;
}

export async function downloadMedia(
  fetch: ILinkFetch,
  url: string,
  sessionToken: string,
): Promise<DownloadedMedia | null> {
  try {
    const response = await fetch(
      `${url}${url.includes('?') ? '&' : '?'}sessionToken=${encodeURIComponent(sessionToken)}`,
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';

    return { data, contentType };
  } catch {
    return null;
  }
}

export async function uploadMedia(
  fetch: ILinkFetch,
  data: Uint8Array,
  fileName: string,
  mimeType: string,
  sessionToken: string,
): Promise<string | null> {
  if (data.byteLength > MAX_MEDIA_SIZE) {
    return null;
  }

  try {
    const formData = new FormData();
    formData.append('file', new Blob([data], { type: mimeType }), fileName);

    const response = await fetch(
      `${ILINK_BASE_URL}/media/upload?sessionToken=${encodeURIComponent(sessionToken)}`,
      {
        method: 'POST',
        body: formData as any,
      },
    );

    if (!response.ok) {
      return null;
    }

    const body = await response.json() as { code: number; data?: { mediaId: string } };
    if (body.code !== 0) {
      return null;
    }

    return body.data?.mediaId ?? null;
  } catch {
    return null;
  }
}
