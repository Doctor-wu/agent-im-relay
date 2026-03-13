import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
  it('reads required Feishu fields from ~/.agent-inbox/config.jsonl', async () => {
    const homeDir = await mkdtemp('/tmp/agent-inbox-feishu-home-');
    const configDir = join(homeDir, '.agent-inbox');
    vi.stubEnv('HOME', homeDir);

    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'config.jsonl'), [
      '{"type":"meta","version":1}',
      '{"type":"im","id":"feishu","enabled":true,"config":{"appId":"cli_test_app_id","appSecret":"test-secret","baseUrl":"https://example.invalid"}}',
    ].join('\n'), 'utf-8');

    const config = readFeishuConfig();

    expect(config.feishuAppId).toBe('cli_test_app_id');
    expect(config.feishuAppSecret).toBe('test-secret');
    expect(config.feishuBaseUrl).toBe('https://example.invalid');
    expect(config.feishuModelSelectionTimeoutMs).toBe(10_000);
    expect(config.feishuPort).toBeUndefined();
    expect(config.agentTimeoutMs).toBeGreaterThan(0);
  });

  it('allows overriding the model auto-selection timeout from shared config', async () => {
    const homeDir = await mkdtemp('/tmp/agent-inbox-feishu-home-');
    const configDir = join(homeDir, '.agent-inbox');
    vi.stubEnv('HOME', homeDir);

    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'config.jsonl'), [
      '{"type":"meta","version":1}',
      '{"type":"im","id":"feishu","enabled":true,"config":{"appId":"cli_test_app_id","appSecret":"test-secret","modelSelectionTimeoutMs":2500}}',
    ].join('\n'), 'utf-8');

    const config = readFeishuConfig();

    expect(config.feishuModelSelectionTimeoutMs).toBe(2_500);
  });

  it('throws when required Feishu config is missing from the shared file', async () => {
    const homeDir = await mkdtemp('/tmp/agent-inbox-feishu-home-');
    const configDir = join(homeDir, '.agent-inbox');
    vi.stubEnv('HOME', homeDir);

    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'config.jsonl'), '{"type":"meta","version":1}\n', 'utf-8');

    expect(() => readFeishuConfig()).toThrow(
      'Missing required feishu configuration in ~/.agent-inbox/config.jsonl',
    );
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
