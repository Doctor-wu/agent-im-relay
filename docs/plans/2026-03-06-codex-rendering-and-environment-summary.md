# Codex Rendering and Environment Summary Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve Discord rendering for Codex-backed threads, emit backend-sourced environment summaries on the first agent run in a thread, and decouple `cwd` from the thread setup flow.

**Architecture:** Extend the shared agent stream contract with a structured `environment` event emitted by each backend before normal text/tool output. Keep Discord-side rendering lightweight by adding explicit environment rendering plus targeted Markdown cleanup for Codex-heavy output instead of introducing a full Markdown AST pipeline. Move `cwd` management out of startup UI and into explicit thread controls while preserving backend auto-detection and persisted thread overrides.

**Tech Stack:** TypeScript, Node.js child processes, Discord.js v14, Vitest, pnpm workspaces

---

### Task 1: Add a shared environment event to the core stream contract

**Files:**
- Modify: `packages/core/src/agent/session.ts`
- Modify: `packages/core/src/agent/backend.ts`
- Test: `packages/core/src/__tests__/backends/codex.test.ts`

**Step 1: Write the failing test**

Add a test in `packages/core/src/__tests__/backends/codex.test.ts` that expects the Codex backend to emit an `environment` event before its first `text` event:

```ts
it('emits environment details before agent text', async () => {
  vi.mocked(spawn).mockReturnValue(
    makeProcess([
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_1', type: 'agent_message', text: 'Hello from Codex' },
      }),
    ].join('\n')) as any,
  );

  const { codexBackend } = await import('../../agent/backends/codex.js');
  const events = await collect(codexBackend.stream({
    mode: 'code',
    prompt: 'test',
    cwd: '/tmp/project',
    model: 'gpt-5-codex',
  }));

  expect(events[0]).toEqual({
    type: 'environment',
    environment: expect.objectContaining({
      backend: 'codex',
      mode: 'code',
      cwd: expect.objectContaining({ value: '/tmp/project' }),
      model: expect.objectContaining({ requested: 'gpt-5-codex' }),
    }),
  });
  expect(events[1]).toEqual({ type: 'text', delta: 'Hello from Codex' });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core test -- --run packages/core/src/__tests__/backends/codex.test.ts`

Expected: FAIL because `environment` is not part of `AgentStreamEvent` yet.

**Step 3: Write minimal implementation**

Update `packages/core/src/agent/session.ts` so `AgentStreamEvent` includes:

```ts
export type AgentEnvironment = {
  backend: import('./backend.js').BackendName;
  mode: import('./tools.js').AgentMode;
  model: {
    requested?: string;
    resolved?: string;
  };
  cwd: {
    value?: string;
    source: 'explicit' | 'auto-detected' | 'default' | 'unknown';
  };
  git: {
    isRepo: boolean;
    branch?: string;
    repoRoot?: string;
  };
};

export type AgentStreamEvent =
  | { type: 'environment'; environment: AgentEnvironment }
  | { type: 'text'; delta: string }
  | { type: 'tool'; summary: string }
  | { type: 'status'; status: string }
  | { type: 'done'; result: string; sessionId?: string }
  | { type: 'error'; error: string };
```

Keep `packages/core/src/agent/backend.ts` aligned with the updated exported types.

**Step 4: Run test to verify it still fails for the right reason**

Run: `pnpm --filter @agent-im-relay/core test -- --run packages/core/src/__tests__/backends/codex.test.ts`

Expected: FAIL because the Codex backend has not emitted the new event yet, but TypeScript compiles.

**Step 5: Commit**

```bash
git add packages/core/src/agent/session.ts \
        packages/core/src/agent/backend.ts \
        packages/core/src/__tests__/backends/codex.test.ts
git commit -m "feat(core): add environment event to agent stream contract"
```

### Task 2: Emit backend-sourced environment details from Codex and Claude

**Files:**
- Modify: `packages/core/src/agent/backends/codex.ts`
- Modify: `packages/core/src/agent/backends/claude.ts`
- Create: `packages/core/src/agent/environment.ts`
- Test: `packages/core/src/__tests__/backends/codex.test.ts`

**Step 1: Write the failing tests**

Add Codex tests in `packages/core/src/__tests__/backends/codex.test.ts` for:

```ts
it('marks explicit cwd and non-git directories in environment event', async () => {
  // mock spawn as existing helper does
  // mock git probes in new helper to return not-a-repo
  expect(environment.cwd.source).toBe('explicit');
  expect(environment.git).toEqual({ isRepo: false });
});

it('marks auto-detected cwd when Working directory is announced', async () => {
  // stdout contains "Working directory: /home/user/project"
  expect(environment.cwd).toEqual({
    value: '/home/user/project',
    source: 'auto-detected',
  });
});
```

Also add a Claude-focused smoke test near the backend helper tests or backend-specific tests verifying that its stream can emit one `environment` event before normal content.

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agent-im-relay/core test -- --run packages/core/src/__tests__/backends/codex.test.ts`

Expected: FAIL because no helper probes or environment event emission exist.

**Step 3: Write minimal implementation**

Create `packages/core/src/agent/environment.ts` with:

```ts
import { spawnSync } from 'node:child_process';
import type { AgentEnvironment, AgentSessionOptions } from './session.js';
import type { BackendName } from './backend.js';

export function detectGitContext(cwd: string): AgentEnvironment['git'] {
  const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  if (root.status !== 0) return { isRepo: false };

  const branch = spawnSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' });
  return {
    isRepo: true,
    repoRoot: root.stdout.trim() || undefined,
    branch: branch.stdout.trim() || undefined,
  };
}

export function buildEnvironmentEvent(
  backend: BackendName,
  options: AgentSessionOptions,
  cwd: string | undefined,
  source: AgentEnvironment['cwd']['source'],
  resolvedModel?: string,
): AgentEnvironment {
  return {
    backend,
    mode: options.mode,
    model: {
      requested: options.model,
      resolved: resolvedModel,
    },
    cwd: {
      value: cwd,
      source,
    },
    git: cwd ? detectGitContext(cwd) : { isRepo: false },
  };
}
```

Then:
- In `packages/core/src/agent/backends/codex.ts`, emit one initial `environment` event before the first `text` event.
- Use `source: 'explicit'` when `options.cwd` exists.
- Use `source: 'default'` when falling back to configured cwd before any auto-detection.
- If Codex later announces `Working directory: ...`, update the remembered cwd and, if the first environment event used a placeholder/default cwd, emit a replacement `environment` event with `source: 'auto-detected'`.
- In `packages/core/src/agent/backends/claude.ts`, emit a single environment event using the selected cwd and requested model before normal stream events.

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @agent-im-relay/core test -- --run packages/core/src/__tests__/backends/codex.test.ts`

Expected: PASS for the new environment coverage and existing Codex backend behavior.

**Step 5: Commit**

```bash
git add packages/core/src/agent/environment.ts \
        packages/core/src/agent/backends/codex.ts \
        packages/core/src/agent/backends/claude.ts \
        packages/core/src/__tests__/backends/codex.test.ts
git commit -m "feat(core): emit backend environment summaries"
```

### Task 3: Render environment summaries and improve Discord Markdown for Codex-heavy output

**Files:**
- Modify: `packages/discord/src/stream.ts`
- Test: `packages/discord/src/__tests__/stream.test.ts`

**Step 1: Write the failing tests**

Add tests in `packages/discord/src/__tests__/stream.test.ts` for:

```ts
it('renders environment events as a standalone summary message', async () => {
  async function* events() {
    yield {
      type: 'environment' as const,
      environment: {
        backend: 'codex',
        mode: 'code',
        model: { requested: 'gpt-5-codex' },
        cwd: { value: '/tmp/project', source: 'auto-detected' },
        git: { isRepo: true, branch: 'feature/demo', repoRoot: '/tmp/project' },
      },
    };
    yield { type: 'text' as const, delta: '## Done\\n- item 1\\n- item 2' };
    yield { type: 'done' as const, result: '## Done\\n- item 1\\n- item 2' };
  }

  await streamAgentToDiscord({ channel: { send } as any }, events());

  expect(send).toHaveBeenNthCalledWith(1, expect.objectContaining({
    content: expect.stringContaining('## Environment'),
  }));
});

it('normalizes list and heading spacing for Discord output', () => {
  const input = 'Intro\\n## Plan\\n- item 1\\n- item 2\\n> note\\n```ts\\nconst x = 1\\n```';
  expect(convertMarkdownForDiscord(input).text).toBe([
    'Intro',
    '',
    '## Plan',
    '- item 1',
    '- item 2',
    '',
    '> note',
    '',
    '```ts',
    'const x = 1',
    '```',
  ].join('\\n'));
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agent-im-relay/discord test -- --run packages/discord/src/__tests__/stream.test.ts`

Expected: FAIL because `streamAgentToDiscord` does not handle `environment` events and Markdown spacing is unchanged.

**Step 3: Write minimal implementation**

In `packages/discord/src/stream.ts`:
- Add a formatter:

```ts
export function formatEnvironmentSummary(environment: AgentEnvironment): string {
  const lines = ['## Environment'];
  lines.push(`- Backend: ${capitalize(environment.backend)}`);
  lines.push(`- Model: ${environment.model.resolved ?? environment.model.requested ?? 'backend default'}`);
  const cwdSuffix = environment.cwd.source === 'auto-detected' ? ' (auto-detected)' : '';
  lines.push(`- Working directory: ${environment.cwd.value ?? 'unknown'}${cwdSuffix}`);
  lines.push(`- Git branch: ${environment.git.isRepo ? environment.git.branch ?? 'unknown' : 'not a git repository'}`);
  lines.push(`- Mode: ${environment.mode}`);
  return lines.join('\\n');
}
```

- Teach `streamAgentToDiscord()` to send this summary immediately when it sees `event.type === 'environment'`.
- Add a Markdown normalization pass before table extraction:
  - trim leading blank lines
  - ensure one blank line before headings that are not at document start
  - ensure code fences and blockquotes are separated from adjacent paragraphs/lists by a blank line
  - collapse 3+ blank lines to 2
  - keep fenced code blocks untouched

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @agent-im-relay/discord test -- --run packages/discord/src/__tests__/stream.test.ts`

Expected: PASS for environment rendering, Markdown normalization, and existing table/tool formatting tests.

**Step 5: Commit**

```bash
git add packages/discord/src/stream.ts \
        packages/discord/src/__tests__/stream.test.ts
git commit -m "feat(discord): render environment summaries and polish markdown"
```

### Task 4: Remove cwd from startup setup and expose it as an explicit thread control

**Files:**
- Modify: `packages/discord/src/commands/thread-setup.ts`
- Modify: `packages/discord/src/commands/claude-control.ts`
- Test: `packages/discord/src/__tests__/thread-setup.test.ts`
- Test: `packages/discord/src/__tests__/claude-control.test.ts`

**Step 1: Write the failing tests**

Add tests covering:

```ts
it('thread setup only persists backend selection', async () => {
  const result = await promptThreadSetup(thread, 'Fix rendering');
  expect(result).toEqual({ backend: 'codex', cwd: null });
});

it('sets cwd explicitly for the current thread', async () => {
  // invoke cwd control command with "/tmp/project"
  expect(conversationCwd.get(thread.id)).toBe('/tmp/project');
});

it('clears cwd override and falls back to auto-detection', async () => {
  // invoke clear action
  expect(conversationCwd.has(thread.id)).toBe(false);
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agent-im-relay/discord test -- --run packages/discord/src/__tests__/thread-setup.test.ts packages/discord/src/__tests__/claude-control.test.ts`

Expected: FAIL because no dedicated cwd controls exist yet.

**Step 3: Write minimal implementation**

In `packages/discord/src/commands/thread-setup.ts`:
- Keep backend selection only.
- Remove any cwd-related wording from setup messages so the UI is clearly backend-only.

In `packages/discord/src/commands/claude-control.ts`:
- Add explicit subcommands or options for cwd management in the current thread:
  - set cwd
  - clear cwd
  - show environment/cwd summary if a lightweight text response already fits the command design
- Persist `conversationCwd` updates immediately.
- Use the same wording as the environment summary for consistency.

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @agent-im-relay/discord test -- --run packages/discord/src/__tests__/thread-setup.test.ts packages/discord/src/__tests__/claude-control.test.ts`

Expected: PASS for backend-only setup and explicit cwd controls.

**Step 5: Commit**

```bash
git add packages/discord/src/commands/thread-setup.ts \
        packages/discord/src/commands/claude-control.ts \
        packages/discord/src/__tests__/thread-setup.test.ts \
        packages/discord/src/__tests__/claude-control.test.ts
git commit -m "feat(discord): move cwd control out of startup setup"
```

### Task 5: Verify workspace builds and document the new behavior

**Files:**
- Modify: `README.md`
- Test: `packages/core/src/__tests__/backends/codex.test.ts`
- Test: `packages/discord/src/__tests__/stream.test.ts`
- Test: `packages/discord/src/__tests__/thread-setup.test.ts`
- Test: `packages/discord/src/__tests__/claude-control.test.ts`

**Step 1: Write the failing documentation expectation**

Add a short README section describing:
- environment summaries appear only on the first agent run in a thread
- backend setup is separate from cwd controls
- cwd defaults to backend auto-detection unless overridden per thread

**Step 2: Run targeted tests**

Run:

```bash
pnpm --filter @agent-im-relay/core test -- --run packages/core/src/__tests__/backends/codex.test.ts
pnpm --filter @agent-im-relay/discord test -- --run packages/discord/src/__tests__/stream.test.ts packages/discord/src/__tests__/thread-setup.test.ts packages/discord/src/__tests__/claude-control.test.ts
```

Expected: PASS.

**Step 3: Run full package verification**

Run:

```bash
pnpm --filter @agent-im-relay/core build
pnpm --filter @agent-im-relay/discord build
pnpm test
```

Expected: all builds and tests pass.

**Step 4: Update README**

Document the new environment summary behavior and the thread-level cwd workflow in `README.md`.

**Step 5: Commit**

```bash
git add README.md
git commit -m "docs: describe environment summary and cwd workflow"
```
