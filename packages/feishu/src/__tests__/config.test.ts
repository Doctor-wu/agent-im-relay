import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFeishuRuntime,
  readFeishuConfig,
  startFeishuRuntime,
} from '../index.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readFeishuConfig', () => {
  it('parses required Feishu environment variables and defaults without callback fields', () => {
    const config = readFeishuConfig({
      ...process.env,
      FEISHU_APP_ID: 'cli_test_app_id',
      FEISHU_APP_SECRET: 'test-secret',
      FEISHU_BASE_URL: 'https://example.invalid',
    });

    expect(config.feishuAppId).toBe('cli_test_app_id');
    expect(config.feishuAppSecret).toBe('test-secret');
    expect(config.feishuBaseUrl).toBe('https://example.invalid');
    expect(config.feishuModelSelectionTimeoutMs).toBe(10_000);
    expect('feishuPort' in config).toBe(false);
    expect(config.agentTimeoutMs).toBeGreaterThan(0);
  });

  it('allows overriding the model auto-selection timeout', () => {
    const config = readFeishuConfig({
      ...process.env,
      FEISHU_APP_ID: 'cli_test_app_id',
      FEISHU_APP_SECRET: 'test-secret',
      FEISHU_MODEL_SELECTION_TIMEOUT_MS: '2500',
    });

    expect(config.feishuModelSelectionTimeoutMs).toBe(2_500);
  });

  it('throws when required Feishu environment variables are missing', () => {
    expect(() => readFeishuConfig({
      ...process.env,
      FEISHU_APP_ID: '',
      FEISHU_APP_SECRET: '',
    })).toThrow('Missing required environment variable: FEISHU_APP_ID');
  });

  it('applies explicit core runtime settings when building a runtime', () => {
    vi.stubEnv('STATE_FILE', '/tmp/original-state.json');
    vi.stubEnv('ARTIFACTS_BASE_DIR', '/tmp/original-artifacts');

    createFeishuRuntime({
      agentTimeoutMs: 1_000,
      claudeCwd: '/tmp/feishu-workspace',
      stateFile: '/tmp/feishu-explicit-state.json',
      artifactsBaseDir: '/tmp/feishu-explicit-artifacts',
      artifactRetentionDays: 21,
      artifactMaxSizeBytes: 123_456,
      claudeBin: '/tmp/bin/claude',
      codexBin: '/tmp/bin/codex',
      opencodeBin: '/tmp/bin/opencode',
      feishuModelSelectionTimeoutMs: 2_345,
      feishuAppId: 'test-app-id',
      feishuAppSecret: 'test-secret',
      feishuBaseUrl: 'https://open.feishu.cn',
    }, {
      createConnection: () => ({
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
      }),
    });

    expect(process.env['STATE_FILE']).toBe('/tmp/feishu-explicit-state.json');
    expect(process.env['ARTIFACTS_BASE_DIR']).toBe('/tmp/feishu-explicit-artifacts');
    expect(process.env['CLAUDE_CWD']).toBe('/tmp/feishu-workspace');
    expect(process.env['CLAUDE_BIN']).toBe('/tmp/bin/claude');
    expect(process.env['CODEX_BIN']).toBe('/tmp/bin/codex');
    expect(process.env['OPENCODE_BIN']).toBe('/tmp/bin/opencode');
    expect(process.env['FEISHU_MODEL_SELECTION_TIMEOUT_MS']).toBe('2345');
  });
});

describe('startup entry', () => {
  it('exports a runtime entry without import side effects', () => {
    const runtime = createFeishuRuntime({
      agentTimeoutMs: 1_000,
      claudeCwd: process.cwd(),
      stateFile: '/tmp/feishu-runtime-state.json',
      artifactsBaseDir: '/tmp/feishu-runtime-artifacts',
      artifactRetentionDays: 14,
      artifactMaxSizeBytes: 8 * 1024 * 1024,
      claudeBin: '/opt/homebrew/bin/claude',
      codexBin: '/opt/homebrew/bin/codex',
      opencodeBin: '/opt/homebrew/bin/opencode',
      feishuModelSelectionTimeoutMs: 10_000,
      feishuAppId: 'test-app-id',
      feishuAppSecret: 'test-secret',
      feishuBaseUrl: 'https://open.feishu.cn',
    }, {
      createConnection: () => ({
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
      }),
    });

    expect(runtime.started).toBe(false);
    expect(typeof startFeishuRuntime).toBe('function');
  });

  it('starts a runtime without opening an HTTP server', async () => {
    const connection = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    const runtime = createFeishuRuntime({
      agentTimeoutMs: 1_000,
      claudeCwd: process.cwd(),
      stateFile: '/tmp/feishu-test-state.json',
      artifactsBaseDir: '/tmp/feishu-test-artifacts',
      artifactRetentionDays: 14,
      artifactMaxSizeBytes: 8 * 1024 * 1024,
      claudeBin: '/opt/homebrew/bin/claude',
      codexBin: '/opt/homebrew/bin/codex',
      opencodeBin: '/opt/homebrew/bin/opencode',
      feishuModelSelectionTimeoutMs: 10_000,
      feishuAppId: 'test-app-id',
      feishuAppSecret: 'test-secret',
      feishuBaseUrl: 'https://open.feishu.cn',
    }, {
      createConnection: () => connection,
    });

    await runtime.start();

    expect(runtime.started).toBe(true);
    expect(connection.start).toHaveBeenCalledOnce();

    await runtime.stop();
    expect(connection.stop).toHaveBeenCalledOnce();
  });
});
