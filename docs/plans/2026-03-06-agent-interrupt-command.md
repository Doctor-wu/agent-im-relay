# Agent Interrupt Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a backend-agnostic `/interrupt` command that stops the currently running agent task for a conversation without clearing session state, while keeping `/done` unchanged.

**Architecture:** Introduce a shared runtime registry in `@agent-im-relay/core` that owns per-conversation `AbortController` instances and exposes `runConversationSession`, `interruptConversationRun`, and `isConversationRunning`. Route all conversation runs through that shared entry point so both Claude and Codex obey the same interruption mechanism. Expose a Discord-level `/interrupt` command as a neutral, agent-agnostic control surface.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, discord.js, Node.js AbortController, existing core backends (`claude`, `codex`)

---

### Task 1: Add shared conversation runtime tests

**Files:**
- Create: `packages/core/src/agent/__tests__/runtime.test.ts`
- Reference: `packages/core/src/agent/session.ts:1`
- Reference: `packages/core/src/__tests__/backends/codex.test.ts:1`

**Step 1: Write the failing test**

Add tests covering:
- `runConversationSession` registers a conversation as running before iteration
- `interruptConversationRun` aborts the active run and returns `true`
- `interruptConversationRun` returns `false` when nothing is running
- runtime cleanup happens after stream completion
- runtime cleanup happens after abort

Suggested shape:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  interruptConversationRun,
  isConversationRunning,
  runConversationSession,
  resetConversationRuntimeForTests,
} from '../runtime.js';
import type { AgentBackend } from '../backend.js';
function createBackend(events: Array<unknown>): AgentBackend {
  return {
    name: 'claude',
    async *stream(options) {
      for (const event of events) {
        if (options.abortSignal?.aborted) {
          yield { type: 'error', error: 'Agent request aborted' } as const;
          return;
        }
        yield event as never;
      }
    },
  };
}

describe('conversation runtime', () => {
  afterEach(() => {
    resetConversationRuntimeForTests();
  });

  it('tracks active runs and clears them after completion', async () => {
    const events = runConversationSession('conv-1', {
      mode: 'ask',
      prompt: 'hi',
      backend: createBackend([{ type: 'done', result: 'ok' }]),
    });

    expect(isConversationRunning('conv-1')).toBe(true);

    const received = [];
    for await (const event of events) {
      received.push(event);
    }

    expect(received).toEqual([{ type: 'done', result: 'ok' }]);
    expect(isConversationRunning('conv-1')).toBe(false);
  });

  it('aborts an active run', async () => {
    const events = runConversationSession('conv-2', {
      mode: 'ask',
      prompt: 'stop me',
      backend: createBackend([
        { type: 'status', status: 'working' },
        { type: 'done', result: 'should not finish' },
      ]),
    });

    expect(interruptConversationRun('conv-2')).toBe(true);

    const received = [];
    for await (const event of events) {
      received.push(event);
    }

    expect(received).toContainEqual({ type: 'error', error: 'Agent request aborted' });
    expect(isConversationRunning('conv-2')).toBe(false);
  });

  it('returns false when interrupting an idle conversation', () => {
    expect(interruptConversationRun('idle')).toBe(false);
  });
});
**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core vitest run packages/core/src/agent/__tests__/runtime.test.ts`
Expected: FAIL because `runtime.ts` and its exports do not exist yet.

**Step 3: Write minimal implementation**

Create `packages/core/src/agent/runtime.ts` with:
- `const activeControllers = new Map<string, AbortController>()`
- `interruptConversationRun(conversationId: string): boolean`
- `isConversationRunning(conversationId: string): boolean`
- `runConversationSession(conversationId, options)`
- `resetConversationRuntimeForTests()` for test cleanup only

Keep implementation minimal and backend-agnostic:
- If a run already exists for the conversation, throw an error
- Create `AbortController`
- Pass `abortSignal` into `streamAgentSession`
- Cleanup in `finally`

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core vitest run packages/core/src/agent/__tests__/runtime.test.ts`

Expected: PASS

**Step 5: Commit**
bash
git add packages/core/src/agent/runtime.ts packages/core/src/agent/tests/runtime.test.ts
git commit -m "feat(core): add interruptible conversation runtime"
---

### Task 2: Export runtime APIs from core

**Files:**
- Modify: `packages/core/src/index.ts:1`

**Step 1: Write the failing test**

Extend `packages/core/src/agent/__tests__/runtime.test.ts` or add a lightweight export test:
ts
import { describe, expect, it } from 'vitest';
import {
  interruptConversationRun,
  isConversationRunning,
  runConversationSession,
} from '../../index.js';

describe('core exports', () => {
  it('re-exports runtime helpers', () => {
    expect(typeof runConversationSession).toBe('function');
    expect(typeof interruptConversationRun).toBe('function');
    expect(typeof isConversationRunning).toBe('function');
  });
});
**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core vitest run packages/core/src/agent/__tests__/runtime.test.ts`
Expected: FAIL because `index.ts` does not export the new helpers.

**Step 3: Write minimal implementation**

Update `packages/core/src/index.ts` to export:
- `runConversationSession`
- `interruptConversationRun`
- `isConversationRunning`

Do not export test-only helpers from the package root.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core vitest run packages/core/src/agent/__tests__/runtime.test.ts`

Expected: PASS

**Step 5: Commit**
bash
git add packages/core/src/index.ts
git commit -m "refactor(core): export conversation runtime helpers"
---

### Task 3: Ensure Codex backend obeys abort signals

**Files:**
- Modify: `packages/core/src/agent/backends/codex.ts:1`
- Modify: `packages/core/src/__tests__/backends/codex.test.ts:1`

**Step 1: Write the failing test**

Add a test that starts a Codex stream with an `AbortController`, aborts it, and expects the stream to end with an aborted error event instead of hanging or exiting unclearly.

Suggested shape:
ts
it('emits aborted error when abortSignal is triggered', async () => {
  const controller = new AbortController();

  mockSpawnStreamThatWaitsForAbort();

  const events = [];
  const stream = codexBackend.stream({
    mode: 'code',
    prompt: 'long task',
    abortSignal: controller.signal,
  });

  controller.abort();

  for await (const event of stream) {
    events.push(event);
  }

  expect(events).toContainEqual({ type: 'error', error: 'Agent request aborted' });
});
Reuse existing spawn mocking patterns already present in `packages/core/src/__tests__/backends/codex.test.ts:1`.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core vitest run packages/core/src/__tests__/backends/codex.test.ts`

Expected: FAIL if Codex backend does not yet normalize abort handling to the shared contract.
**Step 3: Write minimal implementation**

Update `packages/core/src/agent/backends/codex.ts` to match Claude backend behavior:
- Attach `abortSignal` listener
- On abort, terminate the child process
- Emit `{ type: 'error', error: 'Agent request aborted' }`
- Remove listeners and cleanup in `finally`

Keep the exact error text aligned with Claude to simplify upstream handling.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core vitest run packages/core/src/__tests__/backends/codex.test.ts`

Expected: PASS

**Step 5: Commit**
bash
git add packages/core/src/agent/backends/codex.ts packages/core/src/tests/backends/codex.test.ts
git commit -m "fix(codex): normalize abort handling"
---

### Task 4: Route Discord conversation runs through the shared runtime

**Files:**
- Modify: `packages/discord/src/index.ts:205`
- Reference: `packages/core/src/state.ts:1`

**Step 1: Write the failing test**

Add or extend a Discord conversation-flow test to verify:
- a started run marks the conversation active through the shared runtime
- an interrupted run ends cleanly
- a follow-up run in the same thread can start again after interruption

If there is no direct test harness for `runMentionConversation`, create a focused integration-style test around the helper that currently builds `streamAgentSession(...)`.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/discord vitest run packages/discord/src/__tests__/thread.test.ts`

Expected: FAIL because Discord still calls `streamAgentSession(...)` directly and knows nothing about the shared runtime.

**Step 3: Write minimal implementation**
In `packages/discord/src/index.ts`:
- Replace direct `streamAgentSession({...})` calls with `runConversationSession(thread.id, {...})`
- Keep `activeConversations` as the guard against concurrent tasks in one thread
- Do not add Discord-local controller maps
- Preserve existing session persistence logic and resolved session ID handling

Example target change:
ts
const events = runConversationSession(thread.id, {
  mode: 'code',
  prompt,
  model: conversationModels.get(thread.id),
  effort: conversationEffort.get(thread.id),
  cwd: conversationCwd.get(thread.id) ?? config.claudeCwd,
  backend: conversationBackend.get(thread.id),
  ...(isResume ? { resumeSessionId: sessionId } : { sessionId }),
});
**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/discord vitest run packages/discord/src/__tests__/thread.test.ts`

Expected: PASS

**Step 5: Commit**
bash
git add packages/discord/src/index.ts
git commit -m "refactor(discord): use shared conversation runtime"
---

### Task 5: Add a backend-agnostic `/interrupt` command

**Files:**
- Create: `packages/discord/src/commands/interrupt.ts`
- Modify: `packages/discord/src/index.ts:83`
- Reference: `packages/discord/src/commands/code.ts:1`
- Reference: `packages/discord/src/commands/ask.ts:1`

**Step 1: Write the failing test**

Add a command test covering:
- `/interrupt` inside a thread with an active run replies success
- `/interrupt` inside a thread with no active run replies idle message
- `/interrupt` outside a thread replies that it only works in a thread

Suggested logic for the handler test:
ts
it('interrupts the active conversation run', async () => {
  const reply = vi.fn().mockResolvedValue(undefined);
  const interaction = createThreadInteraction({ reply });

  vi.spyOn(core, 'interruptConversationRun').mockReturnValue(true);
await handleInterruptCommand(interaction);

  expect(core.interruptConversationRun).toHaveBeenCalledWith('thread-123');
  expect(reply).toHaveBeenCalledWith({ content: '⏹️ 已请求中断当前任务。', ephemeral: true });
});
**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/discord vitest run packages/discord/src/__tests__/adapter.test.ts`

Expected: FAIL because `interrupt.ts` and command registration do not exist yet.

**Step 3: Write minimal implementation**

Create `packages/discord/src/commands/interrupt.ts`:
- export `interruptCommand`
- export `handleInterruptCommand`

Behavior:
- Require thread channel
- Call `interruptConversationRun(channel.id)`
- If `true`, reply with `⏹️ 已请求中断当前任务。`
- If `false`, reply with `当前没有正在执行的任务。`
- Use ephemeral replies

Register it in `packages/discord/src/index.ts`:
- add to `commandHandlers`
- add to `commandDefinitions`

Do not place it inside `claude-control.ts`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/discord vitest run packages/discord/src/__tests__/adapter.test.ts`

Expected: PASS

**Step 5: Commit**
bash
git add packages/discord/src/commands/interrupt.ts packages/discord/src/index.ts packages/discord/src/tests/adapter.test.ts
git commit -m "feat(discord): add interrupt command"
---

### Task 6: Make aborted runs render as controlled interruption, not generic failure

**Files:**
- Modify: `packages/discord/src/index.ts:130`
- Modify: `packages/discord/src/stream.ts:1`
- Test: `packages/discord/src/__tests__/stream.test.ts`

**Step 1: Write the failing test**

Add a test asserting that when an event `{ type: 'error', error: 'Agent request aborted' }` arrives, the user-facing Discord output is interruption-oriented, e.g. contains `⏹️ 当前任务已中断。`, not a raw error block.

Suggested expectation:
```ts
expect(renderedContent).toContain('⏹️ 当前任务已中断。');
expect(renderedContent).not.toContain('❌ **Error:** Agent request aborted');


Step 2: Run test to verify it fails

Run: pnpm --filter @agent-im-relay/discord vitest run packages/discord/src/__tests__/stream.test.ts

Expected: FAIL because current behavior likely treats abort as a normal error.

Step 3: Write minimal implementation

Normalize abort-specific rendering in the Discord event handling layer:
Detect exact error text Agent request aborted
Render interruption copy instead:
⏹️ 当前任务已中断。
Keep other errors unchanged

Prefer doing this close to Discord rendering, not by changing the shared event contract.

Step 4: Run test to verify it passes

Run: pnpm --filter @agent-im-relay/discord vitest run packages/discord/src/__tests__/stream.test.ts

Expected: PASS

Step 5: Commit

git add packages/discord/src/index.ts packages/discord/src/stream.ts packages/discord/src/__tests__/stream.test.ts
git commit -m "ux(discord): render agent aborts as interruptions"


---

Task 7: Verify /done semantics remain unchanged
Files:
Modify: packages/discord/src/__tests__/adapter.test.ts:1
Reference: packages/discord/src/index.ts:62

Step 1: Write the failing test

Add or extend tests to assert:
/done still clears saved session state
/done still responds with end-session language
/done is not used as an interrupt path

Suggested assertion:

expect(conversationSessions.has('thread-123')).toBe(false);
expect(reply).toHaveBeenCalledWith('✅ Session ended. Start a new conversation by mentioning me again in a channel.');


Step 2: Run test to verify it fails

Run: pnpm --filter @agent-im-relay/discord vitest run packages/discord/src/__tests__/adapter.test.ts

Expected: FAIL if any /done refactor accidentally changed semantics.
```
**Step 3: Write minimal implementation**

Only change production code if needed to restore exact `/done` behavior. Prefer keeping this as a regression safety task.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/discord vitest run packages/discord/src/__tests__/adapter.test.ts`

Expected: PASS

**Step 5: Commit**
bash
git add packages/discord/src/tests/adapter.test.ts
git commit -m "test(discord): lock done command semantics"
---

### Task 8: Run focused verification, then broader package verification

**Files:**
- No code changes required unless tests reveal a real regression

**Step 1: Run core-focused tests**

Run:
bash
pnpm --filter @agent-im-relay/core vitest run \
  packages/core/src/agent/tests/runtime.test.ts \
  packages/core/src/tests/backends/codex.test.ts
Expected: PASS

**Step 2: Run Discord-focused tests**

Run:
bash
pnpm --filter @agent-im-relay/discord vitest run \
  packages/discord/src/tests/adapter.test.ts \
  packages/discord/src/tests/stream.test.ts \
  packages/discord/src/tests/thread.test.ts
Expected: PASS

**Step 3: Run package test suites**

Run:
bash
pnpm --filter @agent-im-relay/core test
pnpm --filter @agent-im-relay/discord test
Expected: PASS

**Step 4: Run build verification**

Run:
bash
pnpm --filter @agent-im-relay/core build
pnpm --filter @agent-im-relay/discord build
Expected: PASS

**Step 5: Commit verification fixes only if needed**
bash
git add <only-files-related-to-real-regressions>
git commit -m "test: finalize interrupt command verification"
---

### Task 9: Update docs for the new command

**Files:**
- Modify: `README.md:1`

**Step 1: Write the failing doc diff**

Add `/interrupt` to the Discord command list and describe that it interrupts the active run without clearing session state.

Suggested wording:
```md
- Slash commands (`/ask`, `/code`, `/interrupt`, `/skill`, `/model`, `/effort`, `/cwd`, `/resume`, `/sessions`, `/clear`, `/compact`)


And a short note in usage or command descriptions:
/interrupt — Stop the currently running agent task in this conversation
/done — End the saved session for this conversation

Step 2: Review doc consistency

Check:
command list matches actual registration
wording is backend-neutral

Step 3: Apply minimal doc update

Keep the README concise; no long command catalog needed unless the repo already prefers that style.

Step 4: Optional doc check

Run: rg -n "/interrupt|/done|Slash commands" README.md packages/discord/src

Expected: references line up with implementation.

Step 5: Commit

git add README.md
git commit -m "docs: add interrupt command"


---

Implementation notes
Prefer runConversationSession(..., { backend?: BackendName | AgentBackend }) only if tests need direct backend injection; otherwise keep public API narrow
If you allow direct backend injection for tests, keep it internal to runtime or expose only through a test seam
Match abort error text exactly across backends: Agent request aborted
Keep activeConversations and runtime registry separate:
activeConversations = app-level concurrency guard
runtime registry = abort/control plane
Do not persist runtime controllers to disk

Recommended commit order
feat(core): add interruptible conversation runtime
refactor(core): export conversation runtime helpers
fix(codex): normalize abort handling
refactor(discord): use shared conversation runtime
feat(discord): add interrupt command
ux(discord): render agent aborts as interruptions
test(discord): lock done command semantics
docs: add interrupt command
```
