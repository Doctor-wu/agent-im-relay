import { describe, expect, it } from 'vitest';
import { resolveRelayPaths } from '@agent-im-relay/core';
import { parseConfigJsonl } from '../config.js';

describe('app config', () => {
  it('parses JSONL and keeps only valid IMs available', () => {
    const parsed = parseConfigJsonl([
      '{"type":"meta","version":1}',
      '{"type":"im","id":"discord","enabled":true,"note":"discord","config":{"token":"abc","clientId":"123"}}',
      '{"type":"im","id":"feishu","enabled":true,"config":{"appId":"app-1"}}',
      '{"type":"runtime","config":{"agentTimeoutMs":1200}}',
    ].join('\n'));

    expect(parsed.availableIms).toHaveLength(1);
    expect(parsed.availableIms[0]?.id).toBe('discord');
    expect(parsed.runtime.agentTimeoutMs).toBe(1200);
  });

  it('reports malformed lines without crashing the whole file', () => {
    const parsed = parseConfigJsonl('{"type":"meta","version":1}\nnope');

    expect(parsed.errors).toHaveLength(1);
    expect(parsed.records.some(record => record.type === 'meta')).toBe(true);
  });

  it('derives the relay home directory paths', () => {
    const paths = resolveRelayPaths('/tmp/agent-inbox-test');

    expect(paths.homeDir).toBe('/tmp/agent-inbox-test/.agent-inbox');
    expect(paths.configFile).toBe('/tmp/agent-inbox-test/.agent-inbox/config.jsonl');
    expect(paths.stateFile).toBe('/tmp/agent-inbox-test/.agent-inbox/state/sessions.json');
  });
});
