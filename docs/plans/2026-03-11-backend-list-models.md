# Backend `listModels()` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename backend model discovery to `listModels()`, hardcode Claude aliases, emit OpenCode `provider/modelKey` models, and keep relay/IM model selection flowing through unchanged.

**Architecture:** Keep the existing backend capability payload and setup/control flows intact. Change the backend contract and helper names from `getSupportedModels()` to `listModels()`, then update each backend and all consumers to use the renamed API. OpenCode execution must pass the selected model through unchanged so the new `provider/modelKey` identifiers survive end to end.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, Discord.js, Feishu card payload builders, local CLI config parsing

---

### Task 1: Rename the backend contract to `listModels()`

**Files:**
- Modify: `packages/core/src/agent/backend.ts`
- Modify: `packages/core/src/agent/__tests__/backend.test.ts`
- Modify: `packages/core/src/session-control/__tests__/controller.test.ts`
- Modify: `packages/core/src/runtime/__tests__/conversation-runner.test.ts`

**Step 1: Write the failing test**

Update test doubles so they implement `listModels()` instead of `getSupportedModels()`, and rename the backend helper expectations to the new method path.

```ts
const backend: AgentBackend = {
  name: 'claude',
  isAvailable: () => true,
  listModels: () => [{ id: 'sonnet', label: 'sonnet' }],
  stream: async function* () {},
};
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/agent/__tests__/backend.test.ts src/session-control/__tests__/controller.test.ts src/runtime/__tests__/conversation-runner.test.ts`

Expected: FAIL with TypeScript/runtime errors because `AgentBackend` and helpers still reference `getSupportedModels()`.

**Step 3: Write minimal implementation**

Rename the optional backend method and the helper call sites in `packages/core/src/agent/backend.ts`.

```ts
export interface AgentBackend {
  readonly name: BackendName;
  isAvailable(): boolean | Promise<boolean>;
  listModels?(): BackendModel[];
  stream(options: AgentSessionOptions): AsyncGenerator<AgentStreamEvent, void>;
}

export function getBackendSupportedModels(name: BackendName): BackendModel[] {
  try {
    const models = getBackend(name).listModels?.() ?? [];
    return normalizeBackendModels(models);
  } catch {
    return [];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/agent/__tests__/backend.test.ts src/session-control/__tests__/controller.test.ts src/runtime/__tests__/conversation-runner.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/agent/backend.ts packages/core/src/agent/__tests__/backend.test.ts packages/core/src/session-control/__tests__/controller.test.ts packages/core/src/runtime/__tests__/conversation-runner.test.ts
git commit -m "refactor: rename backend model listing api"
```

### Task 2: Update backend implementations and backend-specific tests

**Files:**
- Modify: `packages/core/src/agent/backends/claude.ts`
- Modify: `packages/core/src/agent/backends/opencode.ts`
- Modify: `packages/core/src/agent/backends/codex.ts`
- Modify: `packages/core/src/__tests__/backends/opencode.test.ts`
- Modify: `packages/core/src/__tests__/backends/codex.test.ts`

**Step 1: Write the failing test**

Add/adjust backend tests so:

- Claude expects exactly `sonnet`, `opus`, `haiku`, `sonnet1m`
- OpenCode expects `provider/modelKey` values from `~/.config/opencode/opencode.json`
- OpenCode `createOpencodeArgs()` passes the selected model through unchanged
- Codex tests only move to `listModels()`

```ts
expect(createOpencodeArgs({
  prompt: 'hi',
  mode: 'code',
  model: 'openai/gpt-4.1',
})).toContain('openai/gpt-4.1');
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/__tests__/backends/opencode.test.ts src/__tests__/backends/codex.test.ts`

Expected: FAIL because OpenCode still returns bare model keys and Claude still reads local config files.

**Step 3: Write minimal implementation**

Change each backend to implement the renamed method and new listing rules.

```ts
function listClaudeModels(): BackendModel[] {
  return ['sonnet', 'opus', 'haiku', 'sonnet1m'].map(model => ({
    id: model,
    label: model,
  }));
}

function listOpencodeModels(): BackendModel[] {
  // Parse ~/.config/opencode/opencode.json and return provider/modelKey.
}
```

Update OpenCode argument building so selected models are passed directly:

```ts
if (options.model) {
  args.push('--model', options.model);
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/__tests__/backends/opencode.test.ts src/__tests__/backends/codex.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/agent/backends/claude.ts packages/core/src/agent/backends/opencode.ts packages/core/src/agent/backends/codex.ts packages/core/src/__tests__/backends/opencode.test.ts packages/core/src/__tests__/backends/codex.test.ts
git commit -m "feat: add backend listModels implementations"
```

### Task 3: Update relay/UI consumers and prove the selection flow still works

**Files:**
- Modify: `packages/discord/src/commands/thread-setup.ts`
- Modify: `packages/feishu/src/runtime.ts`
- Modify: `packages/feishu/src/cards.ts`
- Modify: `packages/discord/src/__tests__/thread-setup.test.ts`
- Modify: `packages/feishu/src/__tests__/runtime.test.ts`
- Modify: `packages/feishu/src/__tests__/cards.test.ts`

**Step 1: Write the failing test**

Adjust test fixtures and expectations to use the renamed backend method and to assert the displayed/persisted model values are whatever `listModels()` returns.

```ts
const capability = {
  name: 'opencode',
  models: [{ id: 'openai/gpt-4.1', label: 'openai/gpt-4.1' }],
};
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/thread-setup.test.ts && pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/runtime.test.ts src/__tests__/cards.test.ts`

Expected: FAIL if any consumer or fixture still relies on `getSupportedModels()` or old OpenCode model IDs.

**Step 3: Write minimal implementation**

Update any remaining consumer/test fixture references to the renamed backend method, without changing the current selection UX.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/thread-setup.test.ts && pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/runtime.test.ts src/__tests__/cards.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add packages/discord/src/commands/thread-setup.ts packages/feishu/src/runtime.ts packages/feishu/src/cards.ts packages/discord/src/__tests__/thread-setup.test.ts packages/feishu/src/__tests__/runtime.test.ts packages/feishu/src/__tests__/cards.test.ts
git commit -m "test: align relay model selection with backend listModels"
```

### Task 4: Verify, review, and publish

**Files:**
- Modify: implementation files above
- Create: `docs/plans/2026-03-11-backend-list-models-design.md`
- Create: `docs/plans/2026-03-11-backend-list-models.md`

**Step 1: Run workspace verification**

Run: `pnpm test`

Expected: PASS

**Step 2: Review git scope**

Run: `git status --short && git diff --stat origin/main...HEAD`

Expected: only backend contract, backend implementations, relevant tests, and plan docs are changed.

**Step 3: Publish branch and open PR**

Run:

```bash
git push -u origin feat/backend-list-models
gh pr create --base main --head feat/backend-list-models --title "feat: add backend listModels support" --body-file .github/pull_request_template.md
```

Expected: remote branch pushed and PR URL returned
