import { describe, expect, it } from 'vitest';
import { parseWeChatConfig, WECHAT_CONFIG_DEFAULTS } from '../config';

describe('wechat config parsing', () => {
  it('parses a valid config with all fields', () => {
    const result = parseWeChatConfig({
      name: 'MyBot',
      sessionToken: 'tok_abc123',
      reconnectMaxDelayMs: 60_000,
      heartbeatIntervalMs: 15_000,
      streamingCharThreshold: 300,
      streamingTimeThresholdMs: 2_000,
      selectionTimeoutMs: 5_000,
    });

    expect(result).toEqual({
      name: 'MyBot',
      sessionToken: 'tok_abc123',
      reconnectMaxDelayMs: 60_000,
      heartbeatIntervalMs: 15_000,
      streamingCharThreshold: 300,
      streamingTimeThresholdMs: 2_000,
      selectionTimeoutMs: 5_000,
    });
  });

  it('applies defaults for optional numeric fields', () => {
    const result = parseWeChatConfig({ name: 'Bot' });

    expect(result.reconnectMaxDelayMs).toBe(WECHAT_CONFIG_DEFAULTS.reconnectMaxDelayMs);
    expect(result.heartbeatIntervalMs).toBe(WECHAT_CONFIG_DEFAULTS.heartbeatIntervalMs);
    expect(result.streamingCharThreshold).toBe(WECHAT_CONFIG_DEFAULTS.streamingCharThreshold);
    expect(result.streamingTimeThresholdMs).toBe(WECHAT_CONFIG_DEFAULTS.streamingTimeThresholdMs);
    expect(result.selectionTimeoutMs).toBe(WECHAT_CONFIG_DEFAULTS.selectionTimeoutMs);
  });

  it('defaults reconnectMaxDelayMs to 30s', () => {
    const result = parseWeChatConfig({ name: 'Bot' });
    expect(result.reconnectMaxDelayMs).toBe(30_000);
  });

  it('defaults streaming thresholds to 500 chars / 3s', () => {
    const result = parseWeChatConfig({ name: 'Bot' });
    expect(result.streamingCharThreshold).toBe(500);
    expect(result.streamingTimeThresholdMs).toBe(3_000);
  });

  it('treats empty sessionToken as undefined', () => {
    const result = parseWeChatConfig({ name: 'Bot', sessionToken: '  ' });
    expect(result.sessionToken).toBeUndefined();
  });

  it('trims whitespace from name', () => {
    const result = parseWeChatConfig({ name: '  MyBot  ' });
    expect(result.name).toBe('MyBot');
  });

  it('rejects missing name', () => {
    expect(() => parseWeChatConfig({})).toThrow('non-empty "name"');
  });

  it('rejects empty name', () => {
    expect(() => parseWeChatConfig({ name: '  ' })).toThrow('non-empty "name"');
  });
});
