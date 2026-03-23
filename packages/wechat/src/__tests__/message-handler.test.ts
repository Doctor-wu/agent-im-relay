import { describe, it, expect, vi } from 'vitest';
import type { ILinkMessage } from '../types';

import { convertIncomingMessage, ContextTokenCache } from '../message-handler';

function makeILinkMessage(overrides: Partial<ILinkMessage> = {}): ILinkMessage {
  return {
    msgId: 'msg_001',
    type: 'text',
    content: 'hello world',
    fromUser: 'user_001',
    fromUserName: 'Alice',
    toUser: 'bot_001',
    contextToken: 'ctx_abc123',
    timestamp: 1711180800000,
    ...overrides,
  };
}

describe('convertIncomingMessage', () => {
  it('converts a text message to IncomingMessage', () => {
    const msg = makeILinkMessage();
    const result = convertIncomingMessage(msg, 'TestBot');

    expect(result).toEqual({
      id: 'msg_001',
      conversationId: 'wechat:user_001',
      content: 'hello world',
      authorId: 'user_001',
      authorName: 'Alice',
      isBotMention: true,
      raw: msg,
    });
  });

  it('converts an image message with media info', () => {
    const msg = makeILinkMessage({
      type: 'image',
      content: '',
      media: { mediaId: 'media_001', url: 'https://ilink.bot/media/img.jpg', mimeType: 'image/jpeg', size: 12345 },
    });
    const result = convertIncomingMessage(msg, 'TestBot');

    expect(result.content).toBe('[图片]');
    expect(result.raw).toBe(msg);
  });

  it('converts a file message with media info', () => {
    const msg = makeILinkMessage({
      type: 'file',
      content: 'report.pdf',
      media: { mediaId: 'media_002', url: 'https://ilink.bot/media/report.pdf', mimeType: 'application/pdf', size: 99999 },
    });
    const result = convertIncomingMessage(msg, 'TestBot');

    expect(result.content).toBe('[文件] report.pdf');
  });

  it('handles unknown message type without crashing', () => {
    const msg = makeILinkMessage({ type: 'unknown' as any, content: '' });
    const result = convertIncomingMessage(msg, 'TestBot');

    expect(result.content).toBe('');
    expect(result.id).toBe('msg_001');
  });

  it('sets conversationId to wechat:{fromUser} format', () => {
    const msg = makeILinkMessage({ fromUser: 'wx_user_xyz' });
    const result = convertIncomingMessage(msg, 'TestBot');

    expect(result.conversationId).toBe('wechat:wx_user_xyz');
  });

  it('always sets isBotMention to true (DM-only platform)', () => {
    const msg = makeILinkMessage();
    const result = convertIncomingMessage(msg, 'TestBot');

    expect(result.isBotMention).toBe(true);
  });
});

describe('ContextTokenCache', () => {
  it('stores and retrieves contextToken for a user', () => {
    const cache = new ContextTokenCache();
    cache.set('user_001', 'ctx_token_1');

    expect(cache.get('user_001')).toBe('ctx_token_1');
  });

  it('updates contextToken on new message', () => {
    const cache = new ContextTokenCache();
    cache.set('user_001', 'ctx_old');
    cache.set('user_001', 'ctx_new');

    expect(cache.get('user_001')).toBe('ctx_new');
  });

  it('returns undefined for unknown user', () => {
    const cache = new ContextTokenCache();

    expect(cache.get('unknown_user')).toBeUndefined();
  });

  it('extracts and caches token from inbound ILinkMessage', () => {
    const cache = new ContextTokenCache();
    const msg = makeILinkMessage({ fromUser: 'user_002', contextToken: 'ctx_fresh' });

    cache.updateFromMessage(msg);

    expect(cache.get('user_002')).toBe('ctx_fresh');
  });
});
