import { describe, expect, it } from 'vitest';
import { extractMentionPrompt, resolveInboundDiscordMessage } from '../message-routing.js';

describe('extractMentionPrompt', () => {
  it('strips relay mentions and normalizes whitespace', () => {
    expect(extractMentionPrompt('<@relay-bot>   summarize this   <@!relay-bot>', 'relay-bot')).toBe('summarize this');
  });
});

describe('resolveInboundDiscordMessage', () => {
  it('accepts a human-authored explicit mention', () => {
    expect(resolveInboundDiscordMessage({
      relayBotId: 'relay-bot',
      authorId: 'human-user',
      authorBot: false,
      content: '<@relay-bot> summarize this',
      inGuild: true,
      inActiveThread: false,
    })).toEqual({
      accepted: true,
      prompt: 'summarize this',
      explicitMention: true,
    });
  });

  it('accepts an explicit mention from another bot', () => {
    expect(resolveInboundDiscordMessage({
      relayBotId: 'relay-bot',
      authorId: 'other-bot',
      authorBot: true,
      content: '<@relay-bot> summarize this',
      inGuild: true,
      inActiveThread: false,
    })).toEqual({
      accepted: true,
      prompt: 'summarize this',
      explicitMention: true,
    });
  });

  it('rejects another bot without an explicit relay mention', () => {
    expect(resolveInboundDiscordMessage({
      relayBotId: 'relay-bot',
      authorId: 'other-bot',
      authorBot: true,
      content: 'summarize this',
      inGuild: true,
      inActiveThread: true,
    })).toEqual({
      accepted: false,
    });
  });

  it('rejects messages authored by the relay bot itself', () => {
    expect(resolveInboundDiscordMessage({
      relayBotId: 'relay-bot',
      authorId: 'relay-bot',
      authorBot: true,
      content: '<@relay-bot> summarize this',
      inGuild: true,
      inActiveThread: false,
    })).toEqual({
      accepted: false,
    });
  });

  it('keeps active-thread followups for humans without requiring a mention', () => {
    expect(resolveInboundDiscordMessage({
      relayBotId: 'relay-bot',
      authorId: 'human-user',
      authorBot: false,
      content: 'continue',
      inGuild: true,
      inActiveThread: true,
    })).toEqual({
      accepted: true,
      prompt: 'continue',
      explicitMention: false,
    });
  });
});
