import { afterEach, describe, expect, it } from 'vitest';

import {
  createFeishuServer,
  readFeishuConfig,
  readManagedFeishuClientConfig,
  startFeishuServer,
} from '../index.js';

const startedServers: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(startedServers.splice(0).map(async server => server.stop()));
});

describe('readFeishuConfig', () => {
  it('parses required Feishu environment variables and defaults', () => {
    const config = readFeishuConfig({
      ...process.env,
      FEISHU_APP_ID: 'cli_test_app_id',
      FEISHU_APP_SECRET: 'test-secret',
      FEISHU_CLIENT_ID: 'client-a',
      FEISHU_CLIENT_TOKEN: 'token-a',
      FEISHU_PORT: '4400',
      FEISHU_BASE_URL: 'https://example.invalid',
    });

    expect(config.feishuAppId).toBe('cli_test_app_id');
    expect(config.feishuAppSecret).toBe('test-secret');
    expect(config.feishuClientId).toBe('client-a');
    expect(config.feishuClientToken).toBe('token-a');
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

  it('requires managed client credentials for the gateway mode', () => {
    expect(() => readFeishuConfig({
      ...process.env,
      FEISHU_APP_ID: 'cli_test_app_id',
      FEISHU_APP_SECRET: 'test-secret',
      FEISHU_CLIENT_ID: '',
      FEISHU_CLIENT_TOKEN: '',
    })).toThrow('Missing required environment variable: FEISHU_CLIENT_ID');
  });

  it('reads managed relay client configuration without requiring Feishu app credentials', () => {
    const config = readManagedFeishuClientConfig({
      ...process.env,
      FEISHU_GATEWAY_URL: 'https://gateway.example',
      FEISHU_CLIENT_ID: 'client-a',
      FEISHU_CLIENT_TOKEN: 'token-a',
      FEISHU_CLIENT_POLL_INTERVAL_MS: '2500',
    });

    expect(config.feishuGatewayUrl).toBe('https://gateway.example');
    expect(config.feishuClientId).toBe('client-a');
    expect(config.feishuClientToken).toBe('token-a');
    expect(config.feishuClientPollIntervalMs).toBe(2500);
  });
});

describe('startup entry', () => {
  it('exports a startup entry without import side effects', () => {
    const server = createFeishuServer();

    expect(server.started).toBe(false);
    expect(typeof startFeishuServer).toBe('function');
  });

  it('starts a minimal HTTP server that exposes healthz', async () => {
    const server = createFeishuServer({
      agentTimeoutMs: 1_000,
      claudeCwd: process.cwd(),
      stateFile: '/tmp/feishu-test-state.json',
      artifactsBaseDir: '/tmp/feishu-test-artifacts',
      artifactRetentionDays: 14,
      artifactMaxSizeBytes: 8 * 1024 * 1024,
      claudeBin: '/opt/homebrew/bin/claude',
      codexBin: '/opt/homebrew/bin/codex',
      feishuAppId: 'test-app-id',
      feishuAppSecret: 'test-secret',
      feishuBaseUrl: 'https://open.feishu.cn',
      feishuPort: 0,
      feishuClientId: 'client-a',
      feishuClientToken: 'token-a',
    });
    startedServers.push(server);

    await server.start();

    expect(server.started).toBe(true);
    expect(server.port).toBeGreaterThan(0);

    const response = await fetch(`${server.baseUrl}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('ok');
  });
});
