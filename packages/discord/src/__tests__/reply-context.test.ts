import { describe, expect, it } from 'vitest';
import { buildDiscordReplyPayload, createDiscordReplyContext } from '../reply-context.js';

describe('createDiscordReplyContext', () => {
  it('derives reply context for a trigger authored by another bot', () => {
    expect(createDiscordReplyContext({
      relayBotId: 'relay-bot',
      authorId: 'other-bot',
      authorBot: true,
    })).toEqual({
      mentionUserId: 'other-bot',
    });
  });

  it('returns no mention context for human triggers', () => {
    expect(createDiscordReplyContext({
      relayBotId: 'relay-bot',
      authorId: 'human-user',
      authorBot: false,
    })).toBeUndefined();
  });
});

describe('buildDiscordReplyPayload', () => {
  it('prepends exactly one targeted mention to the message body', () => {
    expect(buildDiscordReplyPayload('Done', {
      mentionUserId: 'other-bot',
    })).toEqual({
      content: '<@other-bot> Done',
      allowedMentions: { users: ['other-bot'] },
    });
  });

  it('scopes allowedMentions.users to the targeted bot only', () => {
    expect(buildDiscordReplyPayload('Heads up', {
      mentionUserId: 'other-bot',
    })).toMatchObject({
      allowedMentions: { users: ['other-bot'] },
    });
  });
});
