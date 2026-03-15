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
      type: 'stream_event',
      event: {
        type: 'permission_request',
        request_id: 'perm-1',
        tool_name: 'Bash',
        reason: 'Run rm -rf build',
      },
    })).toEqual({
      requestId: 'perm-1',
      tool: 'Bash',
      reason: 'Run rm -rf build',
    });

    expect(extractClaudePermissionRequest({
      type: 'permission_request',
      requestId: 'perm-2',
      toolName: 'Edit',
      message: 'Apply patch',
    })).toEqual({
      requestId: 'perm-2',
      tool: 'Edit',
      reason: 'Apply patch',
    });

    expect(extractClaudePermissionRequest({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Need approval' },
          {
            type: 'permission_request',
            request_id: 'perm-3',
            tool_name: 'Read',
            description: 'Open secrets.json',
          },
        ],
      },
    })).toEqual({
      requestId: 'perm-3',
      tool: 'Read',
      reason: 'Open secrets.json',
    });
  });

  it('formats Claude permission decisions as stream-json stdin messages', () => {
    expect(formatClaudePermissionDecision('perm-1', 'approved')).toBe(
      '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Permission request perm-1 approved. Continue with the operation."}]}}\n',
    );
    expect(formatClaudePermissionDecision('perm-1', 'denied')).toBe(
      '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Permission request perm-1 denied. Skip that operation and continue."}]}}\n',
    );
  });
});
