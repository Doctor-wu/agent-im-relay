# Backend Permission V2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Codex and Claude safe-mode backends as real bidirectional transports so IM approval cards control actual CLI permission requests.

**Architecture:** Keep the existing permission runtime and IM adapters intact, but replace each backend's safe-mode transport with a protocol-specific duplex session layer. Codex safe mode will speak JSON-RPC over `codex app-server --listen stdio://`; Claude safe mode will speak bidirectional `stream-json` over stdin/stdout. Auto mode stays backward compatible.

**Tech Stack:** TypeScript, Node.js child processes, pnpm workspaces, Vitest

---

## Chunk 1: Codex Safe-Mode JSON-RPC

### Task 1: Lock the Codex v2 protocol contract with failing tests

**Files:**
- Modify: `packages/core/src/__tests__/backends/codex.test.ts`
- Modify: `packages/core/src/agent/__tests__/session.test.ts`
- Test: `packages/core/src/__tests__/backends/codex.test.ts`
- Test: `packages/core/src/agent/__tests__/session.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that expect:
- `createCodexArgs()` to use `app-server --listen stdio://` in safe mode while preserving `exec --json` for auto mode
- Codex safe-mode initialization helpers to emit `initialize`, `initialized`, `thread/start`, and `turn/start`
- approval requests to parse the real `item/commandExecution/requestApproval` JSON-RPC request and decision responses to serialize as `{ decision: "accepted" | "cancelled" }`
- stream parsing to ignore protocol acks while still surfacing tool/text/error/session events

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core vitest run src/__tests__/backends/codex.test.ts src/agent/__tests__/session.test.ts`
Expected: FAIL because safe mode still uses `exec --json` and lacks a JSON-RPC session layer.

- [ ] **Step 3: Write minimal implementation**

Update the Codex backend to:
- add JSON-RPC helpers for request/notification framing and safe-mode handshake sequencing
- spawn `codex app-server --listen stdio://` in safe mode
- create or resume a thread, start a turn, parse notifications, and route approval responses back over stdin
- preserve current auto-mode behavior and session invalidation handling

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core vitest run src/__tests__/backends/codex.test.ts src/agent/__tests__/session.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent/backends/codex.ts packages/core/src/__tests__/backends/codex.test.ts packages/core/src/agent/__tests__/session.test.ts
git commit -m "feat(core): use codex app-server for safe mode"
```

### Task 2: Verify the Codex permission loop through runtime smoke coverage

**Files:**
- Modify: `packages/core/src/agent/__tests__/permission-mode-smoke.test.ts`
- Test: `packages/core/src/agent/__tests__/permission-mode-smoke.test.ts`

- [ ] **Step 1: Extend the failing smoke test**

Add a Codex-flavoured smoke test that simulates:
- backend registration of a permission responder
- a real approval request event entering the runtime
- a user approval resolving once and writing the protocol response back to stdin

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core vitest run src/agent/__tests__/permission-mode-smoke.test.ts`
Expected: FAIL because the Codex responder shape does not yet match the v2 protocol.

- [ ] **Step 3: Write minimal implementation**

Adjust any shared session/runtime glue needed so Codex safe mode uses the same first-resolution-wins behavior with the new transport.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core vitest run src/agent/__tests__/permission-mode-smoke.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent/__tests__/permission-mode-smoke.test.ts packages/core/src/agent/backends/codex.ts packages/core/src/agent/runtime.ts
git commit -m "test(core): cover codex permission runtime flow"
```

## Chunk 2: Claude Safe-Mode Duplex Stream-JSON

### Task 3: Lock the Claude v2 protocol contract with failing tests

**Files:**
- Modify: `packages/core/src/__tests__/backends/claude.test.ts`
- Modify: `packages/core/src/agent/__tests__/session.test.ts`
- Test: `packages/core/src/__tests__/backends/claude.test.ts`
- Test: `packages/core/src/agent/__tests__/session.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that expect:
- safe-mode args to use `--input-format stream-json --output-format stream-json` without `--dangerously-skip-permissions`
- stdin messages to be structured `control_response` envelopes instead of synthetic user prompts
- `control_request` events with `can_use_tool` to become permission requests, while normal assistant/tool/text events continue to stream

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core vitest run src/__tests__/backends/claude.test.ts src/agent/__tests__/session.test.ts`
Expected: FAIL because safe mode still replies with plain user text and only understands the v1 fixture format.

- [ ] **Step 3: Write minimal implementation**

Update the Claude backend to:
- start safe mode with bidirectional `stream-json`
- send the initial user message over stdin
- parse real `control_request` approval payloads
- respond with `control_response` allow/deny messages
- keep auto mode, model selection, effort, and resume semantics intact

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core vitest run src/__tests__/backends/claude.test.ts src/agent/__tests__/session.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent/backends/claude.ts packages/core/src/__tests__/backends/claude.test.ts packages/core/src/agent/__tests__/session.test.ts
git commit -m "feat(core): use claude duplex stream-json in safe mode"
```

### Task 4: Prove adapter-facing permission events stay stable

**Files:**
- Modify: `packages/discord/src/__tests__/stream.test.ts`
- Modify: `packages/feishu/src/__tests__/events.test.ts`
- Modify: `packages/slack/src/__tests__/runtime.test.ts`
- Test: `packages/discord/src/__tests__/stream.test.ts`
- Test: `packages/feishu/src/__tests__/events.test.ts`
- Test: `packages/slack/src/__tests__/runtime.test.ts`

- [ ] **Step 1: Write the failing tests**

Add or update adapter-boundary tests that expect real permission-request metadata from the new backend flow to still render approve/deny cards and resolve stale clicks safely.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/discord vitest run src/__tests__/stream.test.ts && pnpm --filter @agent-im-relay/feishu vitest run src/__tests__/events.test.ts && pnpm --filter @agent-im-relay/slack vitest run src/__tests__/runtime.test.ts`
Expected: FAIL only if adapter assumptions still depend on the old fake payload shape.

- [ ] **Step 3: Write minimal implementation**

Adjust shared event formatting or adapter fixtures only where necessary so Discord, Feishu, and Slack continue to render and resolve permission cards without backend-specific leakage.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/discord vitest run src/__tests__/stream.test.ts && pnpm --filter @agent-im-relay/feishu vitest run src/__tests__/events.test.ts && pnpm --filter @agent-im-relay/slack vitest run src/__tests__/runtime.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/discord/src/__tests__/stream.test.ts packages/feishu/src/__tests__/events.test.ts packages/slack/src/__tests__/runtime.test.ts
git commit -m "test(adapters): keep permission cards compatible with backend v2"
```

## Chunk 3: Cleanup, Documentation, And Workspace Verification

### Task 5: Remove v1 fake protocol fixtures and align regression coverage

**Files:**
- Modify: `packages/core/src/__tests__/backends/codex.test.ts`
- Modify: `packages/core/src/__tests__/backends/claude.test.ts`
- Modify: `packages/core/src/agent/__tests__/session.test.ts`
- Test: `packages/core/src/__tests__/backends/codex.test.ts`
- Test: `packages/core/src/__tests__/backends/claude.test.ts`
- Test: `packages/core/src/agent/__tests__/session.test.ts`

- [ ] **Step 1: Write the failing regression updates**

Delete or replace fixture assertions that still describe the fabricated v1 approval formats, leaving only tests based on the real Codex and Claude protocol envelopes.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core vitest run src/__tests__/backends/codex.test.ts src/__tests__/backends/claude.test.ts src/agent/__tests__/session.test.ts`
Expected: FAIL until all fixtures and parsing assumptions match the v2 protocol.

- [ ] **Step 3: Write minimal implementation**

Remove dead parsing branches and helper code that only existed to support the fake v1 permission events.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core vitest run src/__tests__/backends/codex.test.ts src/__tests__/backends/claude.test.ts src/agent/__tests__/session.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent/backends/codex.ts packages/core/src/agent/backends/claude.ts packages/core/src/__tests__/backends/codex.test.ts packages/core/src/__tests__/backends/claude.test.ts packages/core/src/agent/__tests__/session.test.ts
git commit -m "refactor(core): remove fake permission protocol fixtures"
```

### Task 6: Document safe-mode protocol requirements and verify the workspace

**Files:**
- Modify: `README.md`
- Modify: `docs/discord-setup.md`
- Test: `README.md`

- [ ] **Step 1: Write the failing documentation checklist**

Add a local checklist that requires README coverage for:
- `permissionMode: "safe"` and `permissionRequestTimeoutMs`
- the capability-based CLI requirements (`codex app-server`, Claude duplex `stream-json`)
- OpenCode safe-mode limitation
- timeout-to-deny behavior

- [ ] **Step 2: Run verification to confirm the docs are missing or stale**

Run: `rg -n "permissionMode|app-server|stream-json|OpenCode|timeout" README.md docs/discord-setup.md`
Expected: Missing or incomplete coverage for one or more required points.

- [ ] **Step 3: Write minimal implementation**

Update the docs to describe the real v2 behavior without pinning exact CLI versions.

- [ ] **Step 4: Run workspace verification**

Run:
- `pnpm --filter @agent-im-relay/core test`
- `pnpm --filter @agent-im-relay/discord test`
- `pnpm --filter @agent-im-relay/feishu test`
- `pnpm --filter @agent-im-relay/slack test`
- `pnpm build`

Expected: PASS across targeted package tests and the workspace build.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/discord-setup.md
git commit -m "docs: describe backend permission mode v2"
```
