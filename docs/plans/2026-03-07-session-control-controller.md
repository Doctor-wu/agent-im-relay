# Session Control Controller Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce a dedicated session-control controller in `@agent-im-relay/core` and migrate Discord and Feishu to consume its normalized command/result contract.

**Architecture:** Add a new `packages/core/src/session-control/` module that owns session-control command semantics and returns explicit effect flags for persistence, confirmation, and continuation clearing. Keep UI rendering and transport inside the platform packages, but remove direct session-control state interpretation from Discord and Feishu where practical.

**Tech Stack:** TypeScript, pnpm workspace packages, Vitest, existing `@agent-im-relay/core`, `@agent-im-relay/discord`, and `@agent-im-relay/feishu`

---

### Task 1: Introduce controller types and result contract in core

**Files:**
- Create: `packages/core/src/session-control/types.ts`
- Create: `packages/core/src/session-control/controller.ts`
- Create: `packages/core/src/session-control/__tests__/controller.test.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write the failing test**

- Add controller tests that assert normalized results for `interrupt`, `done`, `backend`, `confirm-backend`, `cancel-backend`, `model`, and `effort`
- Assert effect flags such as `persist`, `stateChanged`, `clearContinuation`, and `requiresConfirmation`

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/session-control/__tests__/controller.test.ts`
Expected: FAIL because the controller module does not exist yet

**Step 3: Write minimal implementation**

- Define the session-control command and result types
- Implement the controller with the current shared state maps and `interruptConversationRun()`
- Export the controller from `packages/core/src/index.ts`

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/session-control/__tests__/controller.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/session-control/types.ts packages/core/src/session-control/controller.ts packages/core/src/session-control/__tests__/controller.test.ts packages/core/src/index.ts
git commit -m "feat(core): add session control controller"
```

### Task 2: Delegate existing platform conversation helper to the controller

**Files:**
- Modify: `packages/core/src/platform/conversation.ts`
- Modify: `packages/core/src/platform/__tests__/conversation.test.ts`

**Step 1: Write the failing test**

- Extend existing platform conversation tests to assert that `applyConversationControlAction()` still returns the old external shape, now backed by the controller
- Add at least one regression case that checks backend confirmation semantics and continuation clearing

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/platform/__tests__/conversation.test.ts`
Expected: FAIL because the old helper is not yet delegating to the new controller contract

**Step 3: Write minimal implementation**

- Make `applyConversationControlAction()` a compatibility wrapper around the new controller
- Keep existing exports stable while routing semantics through the controller

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/platform/__tests__/conversation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/platform/conversation.ts packages/core/src/platform/__tests__/conversation.test.ts
git commit -m "refactor(core): route platform control actions through session controller"
```

### Task 3: Migrate Feishu control flows to the controller contract

**Files:**
- Modify: `packages/feishu/src/runtime.ts`
- Modify: `packages/feishu/src/server.ts`
- Modify: `packages/feishu/src/__tests__/actions.test.ts`
- Modify: `packages/feishu/src/__tests__/backend-gate.test.ts`

**Step 1: Write the failing test**

- Update Feishu action tests to assert behavior through normalized controller results
- Add or extend a test that verifies backend confirmation still appears only when the controller requests it

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/actions.test.ts src/__tests__/backend-gate.test.ts`
Expected: FAIL because Feishu runtime still branches on the older result interpretation

**Step 3: Write minimal implementation**

- Replace direct interpretation of shared action semantics with controller results
- Keep Feishu-specific card rendering and message transport local to the package
- Persist only when controller effects require it

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/actions.test.ts src/__tests__/backend-gate.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/feishu/src/runtime.ts packages/feishu/src/server.ts packages/feishu/src/__tests__/actions.test.ts packages/feishu/src/__tests__/backend-gate.test.ts
git commit -m "refactor(feishu): use shared session control controller"
```

### Task 4: Migrate Discord command handlers to the controller contract

**Files:**
- Modify: `packages/discord/src/commands/interrupt.ts`
- Modify: `packages/discord/src/commands/done.ts`
- Modify: `packages/discord/src/commands/claude-control.ts`
- Modify: `packages/discord/src/__tests__/adapter.test.ts`

**Step 1: Write the failing test**

- Extend adapter or command tests to assert that Discord replies remain unchanged after moving to the controller
- Add at least one regression that checks persistence occurs only when the controller result requests it

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/adapter.test.ts`
Expected: FAIL because Discord commands still mutate or interpret session-control state directly

**Step 3: Write minimal implementation**

- Route Discord command handlers through the session-control controller
- Preserve slash-command UX and wording while consuming normalized controller results

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/adapter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/discord/src/commands/interrupt.ts packages/discord/src/commands/done.ts packages/discord/src/commands/claude-control.ts packages/discord/src/__tests__/adapter.test.ts
git commit -m "refactor(discord): use shared session control controller"
```

### Task 5: Run workspace verification and update any affected documentation

**Files:**
- Modify: `docs/plans/2026-03-07-session-control-controller-design.md`
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

- Update the design doc status and any file paths that changed during implementation
- Update `README.md` only if session-control architecture or platform behavior changed visibly

**Step 4: Re-run final verification**

Run:

- `pnpm test`
- `pnpm build`

Expected: PASS

**Step 5: Commit**

```bash
git add docs/plans/2026-03-07-session-control-controller-design.md README.md
git commit -m "docs: capture session control controller architecture"
```
