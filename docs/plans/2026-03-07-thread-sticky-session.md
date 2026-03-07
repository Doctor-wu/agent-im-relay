# Thread-Sticky Agent Sessions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make each conversation thread keep one logical agent session until `/done`, using confirmed native backend resume when available and a continuation snapshot fallback otherwise.

**Architecture:** Add a core thread-session manager that owns sticky session bindings, continuation snapshots, and resume-mode selection. Extend backend event streams to emit authoritative session lifecycle events early, then update the conversation runner and platform adapters to use the new manager rather than assuming every saved session string is safe to resume.

**Tech Stack:** TypeScript, pnpm workspace packages, Vitest, existing `@agent-im-relay/core`, `@agent-im-relay/discord`, and `@agent-im-relay/feishu`

---

### Task 1: Add sticky thread-session state and persistence in core

**Files:**
- Create: `packages/core/src/thread-session/types.ts`
- Create: `packages/core/src/thread-session/manager.ts`
- Create: `packages/core/src/thread-session/__tests__/manager.test.ts`
- Modify: `packages/core/src/state.ts`
- Modify: `packages/core/src/persist.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write the failing test**

- Add tests for:
  - opening a new binding with `nativeSessionStatus = pending`
  - confirming a native session ID
  - invalidating a native session
  - saving and loading continuation snapshots
  - clearing both binding and snapshot on close

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/thread-session/__tests__/manager.test.ts`
Expected: FAIL because the manager module and persisted state shape do not exist yet

**Step 3: Write minimal implementation**

- Define `ThreadSessionBinding`, `ThreadContinuationSnapshot`, and resume-mode types
- Implement manager helpers for:
  - `openThreadSessionBinding()`
  - `confirmThreadSessionBinding()`
  - `invalidateThreadSessionBinding()`
  - `updateThreadContinuationSnapshot()`
  - `closeThreadSession()`
  - `resolveThreadResumeMode()`
- Persist the new structures in `packages/core/src/persist.ts`

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/thread-session/__tests__/manager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/thread-session/types.ts packages/core/src/thread-session/manager.ts packages/core/src/thread-session/__tests__/manager.test.ts packages/core/src/state.ts packages/core/src/persist.ts packages/core/src/index.ts
git commit -m "feat(core): add thread-sticky session manager"
```

### Task 2: Extend backend event contracts with authoritative session lifecycle updates

**Files:**
- Modify: `packages/core/src/agent/session.ts`
- Modify: `packages/core/src/agent/backends/codex.ts`
- Modify: `packages/core/src/agent/backends/claude.ts`
- Modify: `packages/core/src/__tests__/backends/codex.test.ts`
- Modify: `packages/core/src/agent/__tests__/session.test.ts`

**Step 1: Write the failing test**

- Add tests proving:
  - Codex emits a session lifecycle event on `thread.started`
  - Codex emits a session lifecycle event on `thread.resumed`
  - Claude emits a session lifecycle event when an authoritative `session_id` is seen
  - the shared agent event union includes the new lifecycle event

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/__tests__/backends/codex.test.ts src/agent/__tests__/session.test.ts`
Expected: FAIL because the event model does not yet expose lifecycle events

**Step 3: Write minimal implementation**

- Add a new `AgentStreamEvent` variant for session lifecycle updates
- Emit it as early as possible in Codex and Claude backends
- Keep `done.sessionId` for backward compatibility while moving correctness to the new lifecycle event

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/__tests__/backends/codex.test.ts src/agent/__tests__/session.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/agent/session.ts packages/core/src/agent/backends/codex.ts packages/core/src/agent/backends/claude.ts packages/core/src/__tests__/backends/codex.test.ts packages/core/src/agent/__tests__/session.test.ts
git commit -m "feat(core): emit authoritative backend session lifecycle events"
```

### Task 3: Route the conversation runner through sticky-session resolution

**Files:**
- Modify: `packages/core/src/runtime/conversation-runner.ts`
- Modify: `packages/core/src/runtime/__tests__/conversation-runner.test.ts`
- Modify: `packages/core/src/platform/conversation.ts`
- Modify: `packages/core/src/platform/__tests__/conversation.test.ts`

**Step 1: Write the failing test**

- Extend runner tests to cover:
  - first message in a thread creates a pending binding
  - confirmed native session IDs are persisted before terminal completion
  - timeout or interrupt keeps the thread open
  - next message in the same thread uses snapshot fallback when native resume is unavailable
  - `/done` is the only path that forces a fresh start next time

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/runtime/__tests__/conversation-runner.test.ts src/platform/__tests__/conversation.test.ts`
Expected: FAIL because the runner still treats `conversationSessions` as directly resumable

**Step 3: Write minimal implementation**

- Replace direct reliance on `conversationSessions` with the thread-session manager
- Persist confirmed native session bindings eagerly on lifecycle events
- Refresh continuation snapshots on `done`, `error`, `timeout`, and `interrupt`
- Keep `/done` semantics as the explicit teardown path

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/runtime/__tests__/conversation-runner.test.ts src/platform/__tests__/conversation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/runtime/conversation-runner.ts packages/core/src/runtime/__tests__/conversation-runner.test.ts packages/core/src/platform/conversation.ts packages/core/src/platform/__tests__/conversation.test.ts
git commit -m "refactor(core): make conversation runner use sticky thread sessions"
```

### Task 4: Preserve sticky-session semantics in Discord

**Files:**
- Modify: `packages/discord/src/index.ts`
- Modify: `packages/discord/src/conversation.ts`
- Modify: `packages/discord/src/commands/done.ts`
- Modify: `packages/discord/src/commands/interrupt.ts`
- Modify: `packages/discord/src/__tests__/conversation.test.ts`
- Modify: `packages/discord/src/__tests__/thread.test.ts`
- Modify: `packages/discord/src/__tests__/adapter.test.ts`

**Step 1: Write the failing test**

- Add Discord regression tests proving:
  - any follow-up message in the same thread reuses the sticky session
  - timeout/interruption does not force a fresh first-run setup on the next message
  - `/done` is the only command that resets the thread to fresh-start behavior

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/conversation.test.ts src/__tests__/thread.test.ts src/__tests__/adapter.test.ts`
Expected: FAIL because Discord still infers continuity directly from the saved session string

**Step 3: Write minimal implementation**

- Update Discord thread routing to ask core whether the thread has an open sticky session
- Keep `interrupt` as run control only
- Keep `done` as explicit thread-session teardown
- Avoid any message-content special casing for "continue"

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/conversation.test.ts src/__tests__/thread.test.ts src/__tests__/adapter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/discord/src/index.ts packages/discord/src/conversation.ts packages/discord/src/commands/done.ts packages/discord/src/commands/interrupt.ts packages/discord/src/__tests__/conversation.test.ts packages/discord/src/__tests__/thread.test.ts packages/discord/src/__tests__/adapter.test.ts
git commit -m "refactor(discord): keep sticky agent sessions per thread"
```

### Task 5: Preserve sticky-session semantics in Feishu

**Files:**
- Modify: `packages/feishu/src/runtime.ts`
- Modify: `packages/feishu/src/server.ts`
- Modify: `packages/feishu/src/__tests__/conversation.test.ts`
- Modify: `packages/feishu/src/__tests__/actions.test.ts`
- Modify: `packages/feishu/src/__tests__/backend-gate.test.ts`

**Step 1: Write the failing test**

- Add Feishu regression tests proving:
  - follow-up messages reuse the same sticky conversation session
  - managed gateway flows keep the same thread binding after timeout/interruption
  - explicit teardown is still required to reset the conversation

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/conversation.test.ts src/__tests__/actions.test.ts src/__tests__/backend-gate.test.ts`
Expected: FAIL because Feishu still reasons about continuity without the new thread-session manager

**Step 3: Write minimal implementation**

- Route Feishu conversation handling through the same sticky-session manager used by Discord
- Keep platform-specific message/card transport logic local
- Ensure `/done` equivalents clear thread-session state while interrupts do not

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/conversation.test.ts src/__tests__/actions.test.ts src/__tests__/backend-gate.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/feishu/src/runtime.ts packages/feishu/src/server.ts packages/feishu/src/__tests__/conversation.test.ts packages/feishu/src/__tests__/actions.test.ts packages/feishu/src/__tests__/backend-gate.test.ts
git commit -m "refactor(feishu): keep sticky agent sessions per conversation"
```

### Task 6: Verify the whole workspace and update docs

**Files:**
- Modify: `docs/plans/2026-03-07-thread-sticky-session-design.md`
- Modify: `README.md`

**Step 1: Run focused verification**

Run:

- `pnpm --filter @agent-im-relay/core test`
- `pnpm --filter @agent-im-relay/discord test`
- `pnpm --filter @agent-im-relay/feishu test`

Expected: PASS

**Step 2: Run workspace verification**

Run:

- `pnpm test`
- `pnpm build`

Expected: PASS

**Step 3: Write minimal documentation updates**

- Update the design doc status and any implementation notes
- Update `README.md` only if the thread continuity model is user-visible or operationally relevant

**Step 4: Re-run final verification**

Run:

- `pnpm test`
- `pnpm build`

Expected: PASS

**Step 5: Commit**

```bash
git add docs/plans/2026-03-07-thread-sticky-session-design.md docs/plans/2026-03-07-thread-sticky-session.md README.md
git commit -m "docs: capture sticky thread session continuity"
```
