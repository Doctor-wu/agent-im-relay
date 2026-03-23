import { ILINK_BASE_URL, ILINK_ALLOWED_HOSTS, type ILinkFetch } from './types';

export const MAX_MEDIA_SIZE = 100 * 1024 * 1024; // 100MB

export interface DownloadedMedia {
  data: ArrayBuffer;
  contentType: string;
}

/**
 * Validate that a URL's host is in the iLink allowed domain list.
 * Prevents leaking sessionToken / Bearer credentials to external URLs.
 */
function isAllowedHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ILINK_ALLOWED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export async function downloadMedia(
  fetch: ILinkFetch,
  url: string,
  sessionToken: string,
): Promise<DownloadedMedia | null> {
  if (!isAllowedHost(url)) {
    console.warn(`[wechat] downloadMedia blocked: host not in allowlist — ${url}`);
    return null;
  }

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });

    if (!response.ok) {
      console.warn(`[wechat] downloadMedia failed: HTTP ${response.status}`);
      return null;
    }

    const data = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';

    return { data, contentType };
  } catch (error) {
    console.warn('[wechat] downloadMedia error:', error);
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
    console.warn(`[wechat] uploadMedia rejected: file size ${data.byteLength} exceeds ${MAX_MEDIA_SIZE}`);
    return null;
  }

  try {
    const formData = new FormData();
    formData.append('file', new Blob([data], { type: mimeType }), fileName);

    const response = await fetch(
      `${ILINK_BASE_URL}/media/upload`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` },
        body: formData as any,
      },
    );

    if (!response.ok) {
      console.warn(`[wechat] uploadMedia failed: HTTP ${response.status}`);
      return null;
    }

    const body = await response.json() as { code: number; data?: { mediaId: string } };
    if (body.code !== 0) {
      console.warn(`[wechat] uploadMedia API error: code ${body.code}`);
      return null;
    }

    return body.data?.mediaId ?? null;
  } catch (error) {
    console.warn('[wechat] uploadMedia error:', error);
    return null;
  }
}
