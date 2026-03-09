import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as feishu from '../index.js';

afterEach(() => {
  feishu.resetFeishuSessionChatsForTests();
});

describe('Feishu session chats', () => {
  it('builds a session-chat record from a private-chat launch', () => {
    expect(feishu.buildFeishuSessionChatRecord({
      sourceP2pChatId: 'p2p-chat-1',
      sourceMessageId: 'message-1',
      sessionChatId: 'session-chat-1',
      creatorOpenId: 'ou_user_1',
      createdAt: '2026-03-08T10:00:00.000Z',
      prompt: '  Review deployment plan  ',
    })).toEqual({
      sourceP2pChatId: 'p2p-chat-1',
      sourceMessageId: 'message-1',
      sessionChatId: 'session-chat-1',
      creatorOpenId: 'ou_user_1',
      createdAt: '2026-03-08T10:00:00.000Z',
      promptPreview: 'Review deployment plan',
    });
  });

  it('resolves whether a chat is a private launcher or a session chat', () => {
    const record = feishu.buildFeishuSessionChatRecord({
      sourceP2pChatId: 'p2p-chat-1',
      sourceMessageId: 'message-1',
      sessionChatId: 'session-chat-1',
      creatorOpenId: 'ou_user_1',
      createdAt: '2026-03-08T10:00:00.000Z',
      prompt: 'Review deployment plan',
    });
    feishu.rememberFeishuSessionChat(record);

    expect(feishu.resolveFeishuChatSessionKind({
      chatId: 'p2p-chat-1',
      chatType: 'p2p',
    })).toEqual({
      kind: 'private-launcher',
      chatId: 'p2p-chat-1',
    });

    expect(feishu.resolveFeishuChatSessionKind({
      chatId: 'session-chat-1',
      chatType: 'group',
    })).toEqual({
      kind: 'session-chat',
      chatId: 'session-chat-1',
      record,
    });

    expect(feishu.resolveFeishuChatSessionKind({
      chatId: 'group-chat-1',
      chatType: 'group',
    })).toEqual({
      kind: 'group',
      chatId: 'group-chat-1',
    });
  });

  it('exports session-chat helpers from the package surface', () => {
    expect(typeof feishu.buildFeishuSessionChatRecord).toBe('function');
    expect(typeof feishu.initializeFeishuSessionChats).toBe('function');
    expect(typeof feishu.persistFeishuSessionChats).toBe('function');
    expect(typeof feishu.rememberFeishuSessionChat).toBe('function');
    expect(typeof feishu.findFeishuSessionChatBySourceMessage).toBe('function');
    expect(typeof feishu.resolveFeishuChatSessionKind).toBe('function');
    expect(feishu.resolveFeishuSessionChatStateFile('/tmp/relay/state/sessions.json')).toBe(
      '/tmp/relay/state/feishu-session-chats.json',
    );
  });

  it('finds an existing session chat by its source private-chat message id', () => {
    const record = feishu.buildFeishuSessionChatRecord({
      sourceP2pChatId: 'p2p-chat-1',
      sourceMessageId: 'message-1',
      sessionChatId: 'session-chat-1',
      creatorOpenId: 'ou_user_1',
      createdAt: '2026-03-08T10:00:00.000Z',
      prompt: 'Review deployment plan',
    });

    feishu.rememberFeishuSessionChat(record);

    expect(feishu.findFeishuSessionChatBySourceMessage({
      sourceP2pChatId: 'p2p-chat-1',
      sourceMessageId: 'message-1',
    })).toEqual(record);
    expect(feishu.findFeishuSessionChatBySourceMessage({
      sourceP2pChatId: 'p2p-chat-1',
      sourceMessageId: 'message-2',
    })).toBeUndefined();
  });

  it('keeps the in-memory session chat record lean and launch-oriented', () => {
    const record = feishu.buildFeishuSessionChatRecord({
      sourceP2pChatId: 'p2p-chat-1',
      sourceMessageId: 'message-1',
      sessionChatId: 'session-chat-1',
      creatorOpenId: 'ou_user_1',
      createdAt: '2026-03-08T10:00:00.000Z',
      prompt: 'Review deployment plan',
    });

    feishu.rememberFeishuSessionChat(record);

    expect(feishu.getFeishuSessionChat('session-chat-1')).toEqual(record);
  });

  it('persists and reloads index records with prompt preview, source chat, session chat, and creator', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'feishu-session-chat-'));
    const stateFile = path.join(tempDir, 'sessions.json');
    const record = feishu.buildFeishuSessionChatRecord({
      sourceP2pChatId: 'p2p-chat-1',
      sourceMessageId: 'message-1',
      sessionChatId: 'session-chat-1',
      creatorOpenId: 'ou_user_1',
      createdAt: '2026-03-08T10:00:00.000Z',
      prompt: 'Review deployment plan',
    });

    feishu.rememberFeishuSessionChat(record);
    await feishu.persistFeishuSessionChats(stateFile);

    const persisted = JSON.parse(
      await readFile(feishu.resolveFeishuSessionChatStateFile(stateFile), 'utf-8'),
    ) as { sessionChats: Record<string, unknown> };
    expect(persisted.sessionChats['session-chat-1']).toEqual({
      sourceP2pChatId: 'p2p-chat-1',
      sourceMessageId: 'message-1',
      sessionChatId: 'session-chat-1',
      creatorOpenId: 'ou_user_1',
      createdAt: '2026-03-08T10:00:00.000Z',
      promptPreview: 'Review deployment plan',
    });

    feishu.resetFeishuSessionChatsForTests();
    await feishu.initializeFeishuSessionChats(stateFile);

    expect(feishu.getFeishuSessionChat('session-chat-1')).toEqual(record);

    await rm(tempDir, { recursive: true, force: true });
  });
});
