# Permission Mode Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `permissionMode` and IM-driven approval handling so `safe` mode pauses dangerous Codex and Claude operations for explicit Discord, Feishu, or Slack approval while `auto` mode remains behaviorally identical.

**Architecture:** Extend core runtime with a unified pending-permission controller that owns request lifecycle, timeout, and backend writeback. Adapt Codex and Claude to emit normalized permission events and register backend-specific stdin responders. Wire Discord, Feishu, and Slack to render approval UI and route callbacks back through the shared core controller.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Discord.js, Feishu card payloads, Slack Bolt, existing `@agent-im-relay/core`

---

## File structure

Primary files to modify:

- `packages/core/src/config.ts`
  - add runtime config fields and resolved core config values
- `packages/core/src/index.ts`
  - export new permission runtime APIs and event types
- `packages/core/src/agent/session.ts`
  - extend `AgentStreamEvent` and session options as needed for permission mode
- `packages/core/src/agent/runtime.ts`
  - expand active run registry and expose approve/deny/query helpers
- `packages/core/src/agent/backend.ts`
  - add the minimal backend-side permission responder registration contract
- `packages/core/src/agent/tools.ts`
  - make Claude tool flags depend on permission mode
- `packages/core/src/agent/backends/codex.ts`
  - safe-mode arg handling, permission event extraction, stdin writeback
- `packages/core/src/agent/backends/claude.ts`
  - safe-mode arg handling, permission event extraction, stdin writeback
- `packages/discord/src/index.ts`
  - add button interaction routing
- `packages/discord/src/stream.ts`
  - render permission approval cards/messages
- `packages/feishu/src/cards.ts`
  - add permission card builders and terminal-state card payloads
- `packages/feishu/src/events.ts`
  - route permission actions
- `packages/feishu/src/runtime.ts`
  - bridge permission actions to core APIs
- `packages/slack/src/cards.ts`
  - add permission blocks
- `packages/slack/src/runtime.ts`
  - track pending permission cards and route action callbacks

Likely new helper files:

- `packages/core/src/agent/permissions.ts`
  - shared types and helpers for normalized permission request state
- `packages/discord/src/permissions.ts`
  - Discord-specific card builder and action parsing

Tests to modify:

- `packages/core/src/__tests__/config.test.ts`
- `packages/core/src/__tests__/backends/codex.test.ts`
- `packages/core/src/__tests__/backends/claude.test.ts`
- `packages/core/src/agent/__tests__/runtime.test.ts`
- `packages/core/src/agent/__tests__/session.test.ts`
- `packages/discord/src/__tests__/stream.test.ts`
- `packages/discord/src/__tests__/index.test.ts`
- `packages/feishu/src/__tests__/cards.test.ts`
- `packages/feishu/src/__tests__/actions.test.ts`
- `packages/feishu/src/__tests__/events.test.ts`
- `packages/slack/src/__tests__/cards.test.ts`
- `packages/slack/src/__tests__/runtime.test.ts`

## Chunk 1: Lock the core permission contract with failing tests

### Task 1: Add failing config and runtime tests for permission mode

**Files:**
- Modify: `packages/core/src/__tests__/config.test.ts`
- Modify: `packages/core/src/agent/__tests__/runtime.test.ts`
- Modify: `packages/core/src/agent/__tests__/session.test.ts`

- [ ] **Step 1: Write the failing config tests**

Add tests that assert:
- runtime config defaults include `permissionMode: 'auto'`
- runtime config defaults include `permissionRequestTimeoutMs: 120000`
- explicit `safe` mode survives config parsing and resolution

Use assertions shaped like:

```ts
expect(resolveRuntimeConfig(records)).toMatchObject({
  permissionMode: 'auto',
  permissionRequestTimeoutMs: 120000,
});
```

- [ ] **Step 2: Write the failing runtime tests**

Add tests that describe the new controller contract:
- registering a permission request exposes a pending request
- approving a request resolves it once
- duplicate approve/deny attempts are rejected
- timeout resolves as `timeout` and writes deny through the responder
- ending a run clears pending permission timers

Drive it with a fake responder:

```ts
const writes: Array<'approved' | 'denied'> = [];
registerConversationPermissionResponder('conv-1', {
  backend: 'claude',
  respond(requestId, decision) {
    writes.push(decision);
  },
});
```

- [ ] **Step 3: Write the failing session event test**

Add a test that `AgentStreamEvent` consumers can carry:
- `permission-requested`
- `permission-resolved`

Use a small stream fixture and assert these event objects are forwarded unchanged by session/runtime helpers.

- [ ] **Step 4: Run the targeted tests to verify they fail**

Run:
- `pnpm vitest run packages/core/src/__tests__/config.test.ts`
- `pnpm vitest run packages/core/src/agent/__tests__/runtime.test.ts packages/core/src/agent/__tests__/session.test.ts`

Expected:
- config tests fail because the new runtime keys do not exist
- runtime/session tests fail because permission request state and events are missing

- [ ] **Step 5: Commit the red baseline**

```bash
git add packages/core/src/__tests__/config.test.ts packages/core/src/agent/__tests__/runtime.test.ts packages/core/src/agent/__tests__/session.test.ts
git commit -m "test(core): cover permission mode runtime contract"
```

## Chunk 2: Implement core config, events, and runtime permission controller

### Task 2: Add config fields and permission lifecycle support

**Files:**
- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/agent/session.ts`
- Modify: `packages/core/src/agent/runtime.ts`
- Modify: `packages/core/src/agent/backend.ts`
- Create: `packages/core/src/agent/permissions.ts`

- [ ] **Step 1: Implement the smallest config change**

Add:

```ts
type PermissionMode = 'auto' | 'safe';

permissionMode?: PermissionMode;
permissionRequestTimeoutMs?: number;
```

Resolve them into `CoreConfig` with:

```ts
permissionMode: runtime.permissionMode ?? 'auto',
permissionRequestTimeoutMs: runtime.permissionRequestTimeoutMs ?? 120000,
```

- [ ] **Step 2: Add normalized permission event types**

Extend `AgentStreamEvent` with objects shaped like:

```ts
{
  type: 'permission-requested',
  requestId: string,
  backend: string,
  tool?: string,
  reason?: string,
  expiresAt: string,
}
```

and:

```ts
{
  type: 'permission-resolved',
  requestId: string,
  backend: string,
  decision: 'approved' | 'denied' | 'timeout',
}
```

- [ ] **Step 3: Implement the runtime permission registry**

Create focused helpers in `packages/core/src/agent/permissions.ts` or `runtime.ts`:

```ts
export function registerConversationPermissionResponder(...)
export function registerPermissionRequest(...)
export function resolvePermissionRequest(...)
export function getPendingPermissionRequest(...)
export function clearConversationPermissionState(...)
```

Requirements:
- one active responder per conversation
- first resolution wins
- timeout auto-deny uses the same resolver path
- cleanup clears timers and request state

- [ ] **Step 4: Wire runtime lifecycle cleanup**

Update `runConversationSession()` so the active run registry stores both abort control and permission responder state, and always clears permission state in `finally`.

- [ ] **Step 5: Export the new API from core**

Re-export the normalized permission helpers from `packages/core/src/index.ts` so platform packages can call them without reaching into internal paths.

- [ ] **Step 6: Run the targeted core tests**

Run:
- `pnpm vitest run packages/core/src/__tests__/config.test.ts`
- `pnpm vitest run packages/core/src/agent/__tests__/runtime.test.ts packages/core/src/agent/__tests__/session.test.ts`

Expected: PASS

- [ ] **Step 7: Commit the core controller slice**

```bash
git add packages/core/src/config.ts packages/core/src/index.ts packages/core/src/agent/session.ts packages/core/src/agent/runtime.ts packages/core/src/agent/backend.ts packages/core/src/agent/permissions.ts packages/core/src/__tests__/config.test.ts packages/core/src/agent/__tests__/runtime.test.ts packages/core/src/agent/__tests__/session.test.ts
git commit -m "feat(core): add permission mode runtime support"
```

## Chunk 3: Add failing backend tests for safe-mode protocol handling

### Task 3: Lock Codex and Claude behavior before implementation

**Files:**
- Modify: `packages/core/src/__tests__/backends/codex.test.ts`
- Modify: `packages/core/src/__tests__/backends/claude.test.ts`

- [ ] **Step 1: Add failing Codex tests**

Cover:
- `createCodexArgs()` keeps `--full-auto` in `auto`
- `createCodexArgs()` omits `--full-auto` in `safe`
- `extractCodexEvents()` maps a permission request fixture into `permission-requested`
- the backend writeback helper encodes approve/deny to stdin correctly

Use a fixture shaped like:

```ts
{
  type: 'permission.requested',
  id: 'perm-1',
  tool: 'Bash',
  reason: 'Run rm -rf build',
}
```

Adjust the exact fixture to the real Codex stream payload once confirmed during implementation.

- [ ] **Step 2: Add failing Claude tests**

Cover:
- `createClaudeArgs()` keeps `--dangerously-skip-permissions` in `auto`
- `createClaudeArgs()` omits it in `safe`
- `extractEvents()` maps a Claude stream-json permission fixture into `permission-requested`
- the backend writeback helper encodes approve/deny to stdin correctly

Use a fixture shaped like:

```ts
{
  type: 'stream_event',
  event: {
    type: 'permission_request',
    request_id: 'perm-1',
    tool_name: 'Bash',
  },
}
```

Adjust field names to the real Claude payload once confirmed.

- [ ] **Step 3: Run the targeted backend tests to verify they fail**

Run:
- `pnpm vitest run packages/core/src/__tests__/backends/codex.test.ts`
- `pnpm vitest run packages/core/src/__tests__/backends/claude.test.ts`

Expected:
- arg tests fail because permission mode is not threaded through
- parser/writeback tests fail because the helpers do not exist yet

- [ ] **Step 4: Commit the red backend baseline**

```bash
git add packages/core/src/__tests__/backends/codex.test.ts packages/core/src/__tests__/backends/claude.test.ts
git commit -m "test(core): cover backend permission protocols"
```

## Chunk 4: Implement backend safe-mode parsing and stdin responders

### Task 4: Adapt Codex and Claude without regressing auto mode

**Files:**
- Modify: `packages/core/src/agent/tools.ts`
- Modify: `packages/core/src/agent/backends/codex.ts`
- Modify: `packages/core/src/agent/backends/claude.ts`
- Modify: `packages/core/src/__tests__/backends/codex.test.ts`
- Modify: `packages/core/src/__tests__/backends/claude.test.ts`

- [ ] **Step 1: Thread permission mode into backend options**

Ensure both backends can read resolved `permissionMode` from core config or session/runtime state without changing existing call sites more than necessary.

- [ ] **Step 2: Implement the Codex arg and parser changes**

Implement the smallest change set:
- only omit `--full-auto` in `safe`
- detect permission request payloads
- register/respond through the core permission controller

- [ ] **Step 3: Implement the Claude arg and parser changes**

Implement the smallest change set:
- only omit `--dangerously-skip-permissions` in `safe`
- detect permission request payloads
- register/respond through the core permission controller

- [ ] **Step 4: Preserve current behavior around sessions, text, tools, and errors**

Keep all existing event extraction branches and only insert new permission-specific branches where needed.

- [ ] **Step 5: Run the targeted backend tests**

Run:
- `pnpm vitest run packages/core/src/__tests__/backends/codex.test.ts`
- `pnpm vitest run packages/core/src/__tests__/backends/claude.test.ts`
- `pnpm vitest run packages/core/src/agent/__tests__/runtime.test.ts packages/core/src/agent/__tests__/session.test.ts`

Expected: PASS

- [ ] **Step 6: Commit the backend slice**

```bash
git add packages/core/src/agent/tools.ts packages/core/src/agent/backends/codex.ts packages/core/src/agent/backends/claude.ts packages/core/src/__tests__/backends/codex.test.ts packages/core/src/__tests__/backends/claude.test.ts packages/core/src/agent/__tests__/runtime.test.ts packages/core/src/agent/__tests__/session.test.ts
git commit -m "feat(core): add backend permission request handling"
```

## Chunk 5: Add failing platform tests for approval UI and callbacks

### Task 5: Lock Discord, Feishu, and Slack platform behavior with tests

**Files:**
- Modify: `packages/discord/src/__tests__/stream.test.ts`
- Modify: `packages/discord/src/__tests__/index.test.ts`
- Modify: `packages/feishu/src/__tests__/cards.test.ts`
- Modify: `packages/feishu/src/__tests__/actions.test.ts`
- Modify: `packages/feishu/src/__tests__/events.test.ts`
- Modify: `packages/slack/src/__tests__/cards.test.ts`
- Modify: `packages/slack/src/__tests__/runtime.test.ts`

- [ ] **Step 1: Add failing Discord tests**

Cover:
- `permission-requested` renders a button card/message
- button interactions resolve approve/deny through the core API
- stale clicks return an ephemeral expired/already-handled response

- [ ] **Step 2: Add failing Feishu tests**

Cover:
- permission card payload builder
- permission action routing to the shared core resolver
- card update to terminal state on approve, deny, and timeout

- [ ] **Step 3: Add failing Slack tests**

Cover:
- permission blocks include approve and deny actions
- runtime action handling resolves through the shared core resolver
- duplicate/stale actions are rejected cleanly

- [ ] **Step 4: Run targeted platform tests to verify they fail**

Run:
- `pnpm vitest run packages/discord/src/__tests__/stream.test.ts packages/discord/src/__tests__/index.test.ts`
- `pnpm vitest run packages/feishu/src/__tests__/cards.test.ts packages/feishu/src/__tests__/actions.test.ts packages/feishu/src/__tests__/events.test.ts`
- `pnpm vitest run packages/slack/src/__tests__/cards.test.ts packages/slack/src/__tests__/runtime.test.ts`

Expected: FAIL because approval UI, routing, and shared resolver calls are not implemented

- [ ] **Step 5: Commit the red platform baseline**

```bash
git add packages/discord/src/__tests__/stream.test.ts packages/discord/src/__tests__/index.test.ts packages/feishu/src/__tests__/cards.test.ts packages/feishu/src/__tests__/actions.test.ts packages/feishu/src/__tests__/events.test.ts packages/slack/src/__tests__/cards.test.ts packages/slack/src/__tests__/runtime.test.ts
git commit -m "test(platforms): cover permission approval flows"
```

## Chunk 6: Implement Discord, Feishu, and Slack approval flows

### Task 6: Render approval UI and route callbacks through core

**Files:**
- Modify: `packages/discord/src/index.ts`
- Modify: `packages/discord/src/stream.ts`
- Create: `packages/discord/src/permissions.ts`
- Modify: `packages/feishu/src/cards.ts`
- Modify: `packages/feishu/src/events.ts`
- Modify: `packages/feishu/src/runtime.ts`
- Modify: `packages/slack/src/cards.ts`
- Modify: `packages/slack/src/runtime.ts`

- [ ] **Step 1: Implement Discord permission presentation**

Add a small builder for Discord button payloads that encodes:

```ts
{
  conversationId,
  requestId,
  decision: 'approved' | 'denied',
}
```

Render a permission approval message when the stream sees `permission-requested`.

- [ ] **Step 2: Implement Discord button action handling**

Update `packages/discord/src/index.ts` to handle button interactions, call the shared core resolver, and edit the original message to its terminal state.

- [ ] **Step 3: Implement Feishu permission cards and action routing**

Add new card/action types rather than reusing backend/model control actions. Route them through a shared call like:

```ts
resolveConversationPermissionRequest({
  conversationId,
  requestId,
  decision,
});
```

- [ ] **Step 4: Implement Slack permission blocks and runtime state**

Add a dedicated pending-permission map separate from `pendingRuns`, render permission blocks during active runs, and resolve action callbacks through the same shared core API.

- [ ] **Step 5: Ensure terminal-state UI updates for approve, deny, and timeout**

Each platform should update the original card/block/button message into a read-only result state after the request resolves.

- [ ] **Step 6: Run the targeted platform tests**

Run:
- `pnpm vitest run packages/discord/src/__tests__/stream.test.ts packages/discord/src/__tests__/index.test.ts`
- `pnpm vitest run packages/feishu/src/__tests__/cards.test.ts packages/feishu/src/__tests__/actions.test.ts packages/feishu/src/__tests__/events.test.ts`
- `pnpm vitest run packages/slack/src/__tests__/cards.test.ts packages/slack/src/__tests__/runtime.test.ts`

Expected: PASS

- [ ] **Step 7: Commit the platform slice**

```bash
git add packages/discord/src/index.ts packages/discord/src/stream.ts packages/discord/src/permissions.ts packages/discord/src/__tests__/stream.test.ts packages/discord/src/__tests__/index.test.ts packages/feishu/src/cards.ts packages/feishu/src/events.ts packages/feishu/src/runtime.ts packages/feishu/src/__tests__/cards.test.ts packages/feishu/src/__tests__/actions.test.ts packages/feishu/src/__tests__/events.test.ts packages/slack/src/cards.ts packages/slack/src/runtime.ts packages/slack/src/__tests__/cards.test.ts packages/slack/src/__tests__/runtime.test.ts
git commit -m "feat(platforms): add permission approval interactions"
```

## Chunk 7: Verify end to end and prepare for finish workflow

### Task 7: Run focused and package-level verification

**Files:**
- Modify: any files touched above if verification reveals regressions

- [ ] **Step 1: Run focused core and platform tests**

Run:
- `pnpm vitest run packages/core/src/__tests__/config.test.ts packages/core/src/__tests__/backends/codex.test.ts packages/core/src/__tests__/backends/claude.test.ts packages/core/src/agent/__tests__/runtime.test.ts packages/core/src/agent/__tests__/session.test.ts`
- `pnpm vitest run packages/discord/src/__tests__/stream.test.ts packages/discord/src/__tests__/index.test.ts`
- `pnpm vitest run packages/feishu/src/__tests__/cards.test.ts packages/feishu/src/__tests__/actions.test.ts packages/feishu/src/__tests__/events.test.ts`
- `pnpm vitest run packages/slack/src/__tests__/cards.test.ts packages/slack/src/__tests__/runtime.test.ts`

Expected: PASS

- [ ] **Step 2: Run package-level test commands**

Run:
- `pnpm --filter @agent-im-relay/core test`
- `pnpm --filter @agent-im-relay/discord test`
- `pnpm --filter @agent-im-relay/feishu test`
- `pnpm --filter @agent-im-relay/slack test`

Expected: PASS

- [ ] **Step 3: Run affected package builds**

Run:
- `pnpm --filter @agent-im-relay/core build`
- `pnpm --filter @agent-im-relay/discord build`
- `pnpm --filter @agent-im-relay/feishu build`
- `pnpm --filter @agent-im-relay/slack build`

Expected: PASS

- [ ] **Step 4: Record branch state before finish workflow**

Run:
- `git status --short`
- `git log --oneline --decorate -5`

Expected:
- clean or intentionally staged worktree
- recent commits match the slices above

- [ ] **Step 5: Hand off to finish workflow**

After the implementation and verification pass, invoke `superpowers:finishing-a-development-branch` before creating a PR or merging.
