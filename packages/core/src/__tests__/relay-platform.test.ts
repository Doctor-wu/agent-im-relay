import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import {
  inferRelayPlatformFromConversationId,
  isRelayPlatform,
  relayPlatforms,
} from '../relay-platform';
import { resolveRelayPlatformStateDir } from '../paths';

describe('relay platform — wechat registration', () => {
  it('includes wechat in relayPlatforms', () => {
    expect(relayPlatforms).toContain('wechat');
  });

  it('accepts wechat as a valid relay platform', () => {
    expect(isRelayPlatform('wechat')).toBe(true);
  });

  it('infers wechat from wechat:-prefixed conversation ids', () => {
    expect(inferRelayPlatformFromConversationId('wechat:user123')).toBe('wechat');
    expect(inferRelayPlatformFromConversationId('wechat:wxid_abc123')).toBe('wechat');
  });

  it('does not collide with existing platform id patterns', () => {
    // Discord: numeric only
    expect(inferRelayPlatformFromConversationId('123456789012345678')).toBe('discord');
    // Slack: digits.digits
    expect(inferRelayPlatformFromConversationId('1741766400.123456')).toBe('slack');
    // Feishu: fallback
    expect(inferRelayPlatformFromConversationId('oc_platform_only')).toBe('feishu');
  });

  it('resolves wechat-scoped state directory', async () => {
    const baseDir = await mkdtemp('/tmp/agent-inbox-wechat-state-');
    expect(resolveRelayPlatformStateDir('wechat', baseDir)).toBe(
      join(baseDir, '.agent-inbox', 'state', 'wechat'),
    );
  });
});
