import { describe, expect, it } from 'vitest';

import { createFeishuServer, readFeishuConfig, startFeishuServer } from '../index.js';

describe('readFeishuConfig', () => {
  it('parses required Feishu environment variables and defaults', () => {
    const config = readFeishuConfig({
      ...process.env,
      FEISHU_APP_ID: 'cli_test_app_id',
      FEISHU_APP_SECRET: 'test-secret',
      FEISHU_PORT: '4400',
      FEISHU_BASE_URL: 'https://example.invalid',
    });

    expect(config.feishuAppId).toBe('cli_test_app_id');
    expect(config.feishuAppSecret).toBe('test-secret');
    expect(config.feishuPort).toBe(4400);
    expect(config.feishuBaseUrl).toBe('https://example.invalid');
    expect(config.agentTimeoutMs).toBeGreaterThan(0);
  });

  it('throws when required Feishu environment variables are missing', () => {
    expect(() => readFeishuConfig({
      ...process.env,
      FEISHU_APP_ID: '',
      FEISHU_APP_SECRET: '',
    })).toThrow('Missing required environment variable: FEISHU_APP_ID');
  });
});

describe('startup entry', () => {
  it('exports a startup entry without import side effects', () => {
    const server = createFeishuServer();

    expect(server.started).toBe(false);
    expect(typeof startFeishuServer).toBe('function');
  });
});
