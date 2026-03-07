import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runConversationWithRenderer } = vi.hoisted(() => ({
  runConversationWithRenderer: vi.fn(),
}));

vi.mock('../../runtime/conversation-runner.js', async () => {
  const actual = await vi.importActual<typeof import('../../runtime/conversation-runner.js')>('../../runtime/conversation-runner.js');
  return {
    ...actual,
    runConversationWithRenderer,
  };
});

import { runPlatformConversation } from '../conversation.js';

describe('runPlatformConversation', () => {
  beforeEach(() => {
    runConversationWithRenderer.mockReset();
    runConversationWithRenderer.mockResolvedValue(true);
  });

  it('delegates to the shared runner and prepares attachment prompts', async () => {
    const render = vi.fn(async () => {});
    const publish = vi.fn(async () => {});

    await runPlatformConversation({
      conversationId: 'conv-1',
      target: { id: 'target-1' },
      prompt: 'Summarize it',
      defaultCwd: '/tmp/workspace',
      attachments: [
        {
          name: 'notes.md',
          url: 'https://example.com/notes.md',
          contentType: 'text/markdown',
        },
      ],
      attachmentFetchImpl: vi.fn(async () => new Response('# Notes\nalpha\n', { status: 200 })),
      render,
      publishArtifacts: publish,
    });

    const runnerOptions = runConversationWithRenderer.mock.calls[0]?.[0];
    expect(runnerOptions).toEqual(expect.objectContaining({
      conversationId: 'conv-1',
      target: { id: 'target-1' },
      prompt: 'Summarize it',
      defaultCwd: '/tmp/workspace',
    }));

    const prepared = await runnerOptions.preparePrompt({
      conversationId: 'conv-1',
      prompt: 'Summarize it',
      sourceMessageId: undefined,
    });
    expect(prepared.prompt).toContain('Attached files are available locally for this run:');
    expect(prepared.prompt).toContain('notes.md');

    await runnerOptions.publishArtifacts({
      conversationId: 'conv-1',
      cwd: '/tmp/workspace',
      resultText: [
        'Done.',
        '```artifacts',
        '{"files":[{"path":"missing.txt"}]}',
        '```',
      ].join('\n'),
      sourceMessageId: 'msg-1',
      target: { id: 'target-1' },
    });

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-1',
      sourceMessageId: 'msg-1',
      warnings: [expect.stringContaining('Skipped artifact `missing.txt`')],
    }));
  });

  it('passes through phase callbacks and runner status', async () => {
    const onPhaseChange = vi.fn(async () => {});

    await expect(runPlatformConversation({
      conversationId: 'conv-2',
      target: { id: 'target-2' },
      prompt: 'hello',
      defaultCwd: '/tmp/workspace',
      render: vi.fn(async () => {}),
      onPhaseChange,
    })).resolves.toBe(true);

    expect(runConversationWithRenderer).toHaveBeenCalledWith(expect.objectContaining({
      onPhaseChange,
    }));
  });
});
