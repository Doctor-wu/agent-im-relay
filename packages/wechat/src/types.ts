/** iLink API base URL — single source of truth */
export const ILINK_BASE_URL = 'https://api.ilink.bot/v1';

/** Allowed domains for media download (prevent sessionToken leaking to external URLs) */
export const ILINK_ALLOWED_HOSTS = new Set(['api.ilink.bot', 'media.ilink.bot', 'ilink.bot']);

/** Fetch function type injected for testability */
export type ILinkFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** iLink Bot API message types */
export interface ILinkMessage {
  msgId: string;
  type: 'text' | 'image' | 'file' | 'unknown';
  content: string;
  fromUser: string;
  fromUserName: string;
  toUser: string;
  contextToken: string;
  timestamp: number;
  media?: ILinkMediaInfo;
}

export interface ILinkMediaInfo {
  mediaId?: string;
  url: string;
  fileName?: string;
  fileSize?: number;
  size?: number;
  mimeType?: string;
}

export interface ILinkSendPayload {
  toUser: string;
  contextToken: string;
  type: 'text' | 'image' | 'file';
  content?: string;
  mediaId?: string;
}

export interface ILinkSendResult {
  code: number;
  data?: { msgId: string };
  message?: string;
}

/** QR auth flow types */
export interface QRCodeData {
  qrCodeUrl: string;
  qrCodeBase64?: string;
  expireSeconds: number;
}

export interface ILinkAuthState {
  sessionToken: string | null;
  status: 'disconnected' | 'qr_pending' | 'connected';
}

/** WeChat media attachment */
export interface WeChatMediaAttachment {
  type: 'image' | 'file';
  url: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  localPath?: string;
}

/** WeChat message model */
export interface WeChatMessage {
  id: string;
  type: 'text' | 'image' | 'file' | 'unknown';
  content: string;
  fromUser: string;
  fromUserName: string;
  contextToken: string;
  timestamp: number;
  attachments: WeChatMediaAttachment[];
}

/** WeChat account config */
export interface WeChatAccount {
  name: string;
  sessionToken?: string;
}

/** contextToken cache entry */
export interface ContextTokenEntry {
  token: string;
  updatedAt: number;
}

/** iLink client events */
export type ILinkClientEvent =
  | { type: 'message'; data: ILinkMessage }
  | { type: 'connected' }
  | { type: 'disconnected'; reason?: string }
  | { type: 'qr_code'; data: QRCodeData }
  | { type: 'error'; error: Error };

export type ILinkEventHandler = (event: ILinkClientEvent) => void;
