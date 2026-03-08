# Feishu Long Connection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Feishu callback/server ingress with a direct Feishu long-connection runtime while preserving local conversation execution, cards, files, and sticky-session behavior.

**Architecture:** Remove the Feishu HTTP server and managed relay startup paths, add the official Feishu long-connection client to `packages/feishu`, route long-connection events through a thin adapter into the existing Feishu runtime helpers, and keep outgoing replies on the current Feishu API client path.

**Tech Stack:** TypeScript, Node.js, `@larksuiteoapi/node-sdk`, existing `@agent-im-relay/core` runtime/orchestration, Vitest, tsdown

---

### Task 1: Replace Feishu config and startup surface with runtime-only primitives

**Files:**
- Modify: `agent-im-relay/packages/feishu/src/config.ts`
- Modify: `agent-im-relay/packages/feishu/src/index.ts`
- Modify: `agent-im-relay/packages/feishu/src/__tests__/config.test.ts`
- Modify: `agent-im-relay/packages/feishu/package.json`

**Step 1: Write the failing test**

Update config/startup tests to assert:

- `readFeishuConfig()` no longer requires or returns `feishuPort`
- `createFeishuRuntime()` exists
- server-oriented exports are gone

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/config.test.ts`
Expected: FAIL because config and exports still assume the HTTP server model.

**Step 3: Write minimal implementation**

- Remove `feishuPort` from `FeishuConfig`
- Remove server-oriented exports and add runtime-oriented exports
- Add `@larksuiteoapi/node-sdk` to `packages/feishu/package.json`

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/config.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/feishu/src/config.ts packages/feishu/src/index.ts packages/feishu/src/__tests__/config.test.ts packages/feishu/package.json
git commit -m "refactor(feishu): switch startup surface to runtime mode"
```

### Task 2: Add long-connection event adaptation and runtime startup

**Files:**
- Create: `agent-im-relay/packages/feishu/src/events.ts`
- Modify: `agent-im-relay/packages/feishu/src/index.ts`
- Create: `agent-im-relay/packages/feishu/src/__tests__/events.test.ts`

**Step 1: Write the failing test**

Add tests that assert:

- message events normalize into the local runtime message shape
- card-action events normalize into the local runtime action shape
- runtime startup registers message and card-action handlers on the long-connection dispatcher

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/events.test.ts`
Expected: FAIL because the event-adapter module and runtime registration do not exist.

**Step 3: Write minimal implementation**

- Add a thin event-adapter module for long-connection events
- Build `createFeishuRuntime()` around the Feishu long-connection SDK
- Keep payload-shape translation local to the adapter layer

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/events.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/feishu/src/events.ts packages/feishu/src/index.ts packages/feishu/src/__tests__/events.test.ts
git commit -m "feat(feishu): add long-connection event runtime"
```

### Task 3: Rewire message and file handling from callback payloads to long-connection events

**Files:**
- Modify: `agent-im-relay/packages/feishu/src/conversation.ts`
- Modify: `agent-im-relay/packages/feishu/src/runtime.ts`
- Modify: `agent-im-relay/packages/feishu/src/index.ts`
- Modify: `agent-im-relay/packages/feishu/src/__tests__/runtime.test.ts`

**Step 1: Write the failing test**

Update runtime tests to assert:

- long-connection message events still derive the correct `conversationId`
- file events still queue attachments and emit the existing acknowledgement message
- text events still call `runFeishuConversation()` with the right prompt and mode

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/runtime.test.ts`
Expected: FAIL because runtime helpers still assume callback-driven payload shapes.

**Step 3: Write minimal implementation**

- Adjust event-to-message normalization where required
- Reuse existing runtime helpers instead of rebuilding conversation logic
- Keep pending-attachment and pending-run semantics unchanged

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/runtime.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/feishu/src/conversation.ts packages/feishu/src/runtime.ts packages/feishu/src/index.ts packages/feishu/src/__tests__/runtime.test.ts
git commit -m "refactor(feishu): route message and file events through long connection"
```

### Task 4: Keep card-driven controls on the long-connection event path

**Files:**
- Modify: `agent-im-relay/packages/feishu/src/cards.ts`
- Modify: `agent-im-relay/packages/feishu/src/runtime.ts`
- Modify: `agent-im-relay/packages/feishu/src/__tests__/actions.test.ts`
- Modify: `agent-im-relay/packages/feishu/src/__tests__/events.test.ts`

**Step 1: Write the failing test**

Add tests that assert:

- card-action event payloads map to the existing control actions
- backend confirmation cards are re-sent correctly
- confirming backend selection resumes the blocked run

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/actions.test.ts src/__tests__/events.test.ts`
Expected: FAIL because card actions are still wired through callback-era assumptions.

**Step 3: Write minimal implementation**

- Update card metadata or adapter logic only where the long-connection action payload shape differs
- Keep `handleFeishuControlAction()` and `resumePendingFeishuRun()` as the execution boundary

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/actions.test.ts src/__tests__/events.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/feishu/src/cards.ts packages/feishu/src/runtime.ts packages/feishu/src/__tests__/actions.test.ts packages/feishu/src/__tests__/events.test.ts
git commit -m "feat(feishu): keep card controls on long connection"
```

### Task 5: Remove callback-server and managed-relay code paths

**Files:**
- Delete: `agent-im-relay/packages/feishu/src/server.ts`
- Delete: `agent-im-relay/packages/feishu/src/client.ts`
- Delete: `agent-im-relay/packages/feishu/src/gateway-bridge.ts`
- Delete: `agent-im-relay/packages/feishu/src/gateway-state.ts`
- Delete: `agent-im-relay/packages/feishu/src/__tests__/server.test.ts`
- Delete: `agent-im-relay/packages/feishu/src/__tests__/backend-gate.test.ts`
- Modify: `agent-im-relay/packages/feishu/src/__tests__/config.test.ts`

**Step 1: Write the failing test**

Adjust exports/startup tests so they fail if callback-server or managed-relay modules are still part of the public Feishu runtime path.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/config.test.ts`
Expected: FAIL because obsolete modules and exports still exist.

**Step 3: Write minimal implementation**

- Delete callback-server and managed-relay code not used by the long-connection design
- Remove imports, exports, and tests tied to those paths

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/config.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/feishu/src packages/feishu/src/__tests__
git commit -m "refactor(feishu): remove callback and managed relay paths"
```

### Task 6: Verify the Feishu package end to end

**Files:**
- Modify: `agent-im-relay/packages/feishu/package.json`

**Step 1: Run focused Feishu tests**

Run: `pnpm --filter @agent-im-relay/feishu test`
Expected: PASS.

**Step 2: Run shared-core regression tests**

Run: `pnpm --filter @agent-im-relay/core test`
Expected: PASS.

**Step 3: Run build verification**

Run:

- `pnpm --filter @agent-im-relay/feishu build`
- `pnpm --filter @agent-im-relay/core build`

Expected: PASS.

**Step 4: Add or adjust scripts if needed**

If the runtime entry requires a clearer local launch command, add a dedicated script such as:

- `dev:longconn`
- `start:longconn`

Only add scripts that are actually needed by the final startup shape.

**Step 5: Re-run verification**

Run:

- `pnpm --filter @agent-im-relay/feishu test`
- `pnpm --filter @agent-im-relay/feishu build`
- `pnpm --filter @agent-im-relay/core test`

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/feishu/package.json
git commit -m "test(feishu): verify long-connection runtime"
```
