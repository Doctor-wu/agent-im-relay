import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readFileSyncMock } = vi.hoisted(() => ({
  readFileSyncMock: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: readFileSyncMock,
  };
});

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

import {
  createClaudeArgs,
  extractClaudePermissionRequest,
  formatClaudePermissionDecision,
} from '../../agent/backends/claude.js';

describe('claude backend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFileSyncMock.mockReset();
  });

  it('lists the fixed aliases and keeps configured legacy model ids', async () => {
    readFileSyncMock
      .mockReturnValueOnce(JSON.stringify({ model: 'claude-opus-4-6' }))
      .mockReturnValueOnce(JSON.stringify({ model: 'claude-sonnet-4-5' }));

    const { claudeBackend } = await import('../../agent/backends/claude');

    expect(claudeBackend.listModels?.()).toEqual([
      { id: 'sonnet', label: 'sonnet' },
      { id: 'opus', label: 'opus' },
      { id: 'haiku', label: 'haiku' },
      { id: 'sonnet1m', label: 'sonnet1m' },
      { id: 'claude-opus-4-6', label: 'claude-opus-4-6' },
      { id: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
    ]);
  });

  it('keeps skip-permissions in auto mode and omits it in safe mode', () => {
    const autoArgs = createClaudeArgs({
      mode: 'code',
      prompt: 'fix this',
    }, 'auto');
    const safeArgs = createClaudeArgs({
      mode: 'code',
      prompt: 'fix this',
    }, 'safe');

    expect(autoArgs).toContain('--dangerously-skip-permissions');
    expect(safeArgs).not.toContain('--dangerously-skip-permissions');
  });

  it('extracts permission requests from Claude stream-json payloads', () => {
    expect(extractClaudePermissionRequest({
      type: 'control_request',
      request_id: 'perm-1',
      request: {
        subtype: 'can_use_tool',
        request_id: 'perm-1',
        tool_name: 'Bash',
        input: {
          command: 'rm -rf build',
        },
        tool_use_id: 'tool-1',
      },
    })).toEqual({
      requestId: 'perm-1',
      tool: 'Bash',
      reason: 'rm -rf build',
    });

    expect(extractClaudePermissionRequest({
      type: 'control_request',
      request_id: 'perm-2',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Edit',
        input: {
          file_path: 'package.json',
          old_string: '"version": "1.0.0"',
          new_string: '"version": "1.0.1"',
        },
        tool_use_id: 'tool-2',
      },
    })).toEqual({
      requestId: 'perm-2',
      tool: 'Edit',
      reason: '{"file_path":"package.json","old_string":"\\"version\\": \\"1.0.0\\"","new_string":"\\"version\\": \\"1.0.1\\""}',
    });

    expect(extractClaudePermissionRequest({
      type: 'permission_request',
      requestId: 'perm-legacy',
      toolName: 'Edit',
      message: 'Apply patch',
    })).toBeUndefined();
  });

  it('formats Claude permission decisions as stream-json stdin messages', () => {
    expect(formatClaudePermissionDecision('perm-1', 'approved')).toBe(
      '{"type":"control_response","response":{"subtype":"success","request_id":"perm-1","response":{"behavior":"allow"}}}\n',
    );
    expect(formatClaudePermissionDecision('perm-1', 'denied')).toBe(
      '{"type":"control_response","response":{"subtype":"success","request_id":"perm-1","response":{"behavior":"deny","message":"User denied"}}}\n',
    );
  });
});
