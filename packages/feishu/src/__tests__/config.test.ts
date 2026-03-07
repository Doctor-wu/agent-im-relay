import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFeishuCallbackHandler,
  createFeishuServer,
  readFeishuConfig,
  startFeishuServer,
} from '../index.js';

const startedServers: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(startedServers.splice(0).map(async server => server.stop()));
  vi.unstubAllEnvs();
});

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

  it('applies explicit core runtime settings when building a callback handler', () => {
    vi.stubEnv('STATE_FILE', '/tmp/original-state.json');
    vi.stubEnv('ARTIFACTS_BASE_DIR', '/tmp/original-artifacts');

    createFeishuCallbackHandler({
      agentTimeoutMs: 1_000,
      claudeCwd: '/tmp/feishu-workspace',
      stateFile: '/tmp/feishu-explicit-state.json',
      artifactsBaseDir: '/tmp/feishu-explicit-artifacts',
      artifactRetentionDays: 21,
      artifactMaxSizeBytes: 123_456,
      claudeBin: '/tmp/bin/claude',
      codexBin: '/tmp/bin/codex',
      feishuAppId: 'test-app-id',
      feishuAppSecret: 'test-secret',
      feishuBaseUrl: 'https://open.feishu.cn',
      feishuPort: 3001,
    }, {
      client: {} as never,
    });

    expect(process.env['STATE_FILE']).toBe('/tmp/feishu-explicit-state.json');
    expect(process.env['ARTIFACTS_BASE_DIR']).toBe('/tmp/feishu-explicit-artifacts');
    expect(process.env['CLAUDE_CWD']).toBe('/tmp/feishu-workspace');
    expect(process.env['CLAUDE_BIN']).toBe('/tmp/bin/claude');
    expect(process.env['CODEX_BIN']).toBe('/tmp/bin/codex');
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
