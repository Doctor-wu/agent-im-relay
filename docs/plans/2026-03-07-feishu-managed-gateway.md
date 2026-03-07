# Feishu Managed Gateway MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a managed Feishu gateway plus local relay client bridge so Feishu callbacks no longer need to reach the user's machine directly.

**Architecture:** Keep shared conversation orchestration in `packages/core`, move Feishu callback ownership to a managed gateway in `packages/feishu`, and add a small outbound bridge client that executes runs locally and streams results back through the gateway. Preserve card interactions and existing core state semantics.

**Tech Stack:** TypeScript, Node.js HTTP server, Fetch API, existing core runtime/orchestration, Vitest, tsdown

---

### Task 1: Add shared bridge protocol types

**Files:**
- Create: `packages/core/src/bridge/protocol.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/platform/__tests__/conversation.test.ts`

**Step 1: Write the failing test**

Add a minimal assertion that the exported bridge protocol helpers or types are reachable from `@agent-im-relay/core`.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core test`
Expected: FAIL because the new exports do not exist yet.

**Step 3: Write minimal implementation**

Create protocol types for:

- gateway-to-client commands: `conversation.run`, `conversation.control`, `conversation.file`
- client-to-gateway events: `client.hello`, `client.heartbeat`, `conversation.text`, `conversation.card`, `conversation.file`, `conversation.error`, `conversation.done`

Export them from `packages/core/src/index.ts`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core test`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/bridge/protocol.ts packages/core/src/index.ts packages/core/src/platform/__tests__/conversation.test.ts
git commit -m "feat(core): add managed relay bridge protocol"
```

### Task 2: Add a Feishu gateway state store and bridge router

**Files:**
- Create: `packages/feishu/src/gateway-state.ts`
- Create: `packages/feishu/src/gateway-bridge.ts`
- Test: `packages/feishu/src/__tests__/gateway-bridge.test.ts`

**Step 1: Write the failing test**

Add tests for:

- registering a client connection
- routing a conversation command to the active client
- offline client detection
- routing client-emitted response messages back to the correct pending request

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run packages/feishu/src/__tests__/gateway-bridge.test.ts`
Expected: FAIL because the gateway bridge modules do not exist.

**Step 3: Write minimal implementation**

Implement:

- in-memory client registry keyed by `clientId`
- pending request registry keyed by `requestId`
- helpers to dispatch bridge commands to a client
- helpers to consume bridge responses from a client
- explicit offline error results

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run packages/feishu/src/__tests__/gateway-bridge.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/feishu/src/gateway-state.ts packages/feishu/src/gateway-bridge.ts packages/feishu/src/__tests__/gateway-bridge.test.ts
git commit -m "feat(feishu): add managed gateway bridge routing"
```

### Task 3: Convert the Feishu callback handler into gateway-owned ingress

**Files:**
- Modify: `packages/feishu/src/server.ts`
- Modify: `packages/feishu/src/runtime.ts`
- Modify: `packages/feishu/src/cards.ts`
- Test: `packages/feishu/src/__tests__/server.test.ts`
- Test: `packages/feishu/src/__tests__/actions.test.ts`

**Step 1: Write the failing test**

Add tests that assert:

- message callbacks enqueue a `conversation.run` bridge request instead of executing locally
- card action callbacks enqueue control requests and still emit confirmation/selection cards through the gateway response path
- offline client cases send a clear Feishu text fallback

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run packages/feishu/src/__tests__/server.test.ts packages/feishu/src/__tests__/actions.test.ts`
Expected: FAIL because server/runtime still assume local execution.

**Step 3: Write minimal implementation**

Refactor the Feishu server layer so that:

- callback handlers normalize requests and route them to the managed bridge
- gateway-side card handling applies control actions that do not need local execution
- run-producing actions and prompts are forwarded to the connected client
- gateway side owns pending card metadata needed to rebuild Feishu cards

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run packages/feishu/src/__tests__/server.test.ts packages/feishu/src/__tests__/actions.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/feishu/src/server.ts packages/feishu/src/runtime.ts packages/feishu/src/cards.ts packages/feishu/src/__tests__/server.test.ts packages/feishu/src/__tests__/actions.test.ts
git commit -m "feat(feishu): route callbacks through managed gateway"
```

### Task 4: Add the local managed relay client

**Files:**
- Create: `packages/feishu/src/client.ts`
- Modify: `packages/feishu/src/config.ts`
- Modify: `packages/feishu/src/index.ts`
- Test: `packages/feishu/src/__tests__/client.test.ts`
- Test: `packages/feishu/src/__tests__/config.test.ts`

**Step 1: Write the failing test**

Add tests for:

- reading managed mode config (`FEISHU_GATEWAY_URL`, `FEISHU_CLIENT_ID`, `FEISHU_CLIENT_TOKEN`)
- client hello / heartbeat payload creation
- executing a `conversation.run` command locally and emitting `text`, `error`, and `done`

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run packages/feishu/src/__tests__/client.test.ts packages/feishu/src/__tests__/config.test.ts`
Expected: FAIL because managed client mode does not exist.

**Step 3: Write minimal implementation**

Implement a local client entrypoint that:

- authenticates with the managed gateway
- pulls or receives bridge commands
- executes shared conversation runs locally
- forwards text/card/file/error/done events back to the gateway transport

Keep the transport simple for the MVP. Long-poll or fetch-based request/response is acceptable if it keeps the first implementation small and testable.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run packages/feishu/src/__tests__/client.test.ts packages/feishu/src/__tests__/config.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/feishu/src/client.ts packages/feishu/src/config.ts packages/feishu/src/index.ts packages/feishu/src/__tests__/client.test.ts packages/feishu/src/__tests__/config.test.ts
git commit -m "feat(feishu): add managed relay client"
```

### Task 5: Hook gateway responses back to Feishu APIs and file handling

**Files:**
- Modify: `packages/feishu/src/api.ts`
- Modify: `packages/feishu/src/server.ts`
- Modify: `packages/feishu/src/files.ts`
- Test: `packages/feishu/src/__tests__/api.test.ts`
- Test: `packages/feishu/src/__tests__/files.test.ts`

**Step 1: Write the failing test**

Add tests for:

- gateway sending text replies from client-generated `conversation.text`
- gateway sending interactive cards from client-generated `conversation.card`
- artifact upload from client-generated `conversation.file`

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run packages/feishu/src/__tests__/api.test.ts packages/feishu/src/__tests__/files.test.ts`
Expected: FAIL because the managed response sink is incomplete.

**Step 3: Write minimal implementation**

Reuse the Feishu API client so the gateway can translate bridge events into:

- text replies
- interactive card updates
- file uploads and file messages

Preserve existing artifact staging behavior where possible.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run packages/feishu/src/__tests__/api.test.ts packages/feishu/src/__tests__/files.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/feishu/src/api.ts packages/feishu/src/server.ts packages/feishu/src/files.ts packages/feishu/src/__tests__/api.test.ts packages/feishu/src/__tests__/files.test.ts
git commit -m "feat(feishu): send managed client responses back to Feishu"
```

### Task 6: Verify the managed Feishu MVP end to end

**Files:**
- Modify: `packages/feishu/package.json`
- Modify: `package.json`

**Step 1: Run focused package tests**

Run:

- `pnpm --filter @agent-im-relay/core test`
- `pnpm --filter @agent-im-relay/feishu test`

Expected: PASS.

**Step 2: Run build verification**

Run:

- `pnpm --filter @agent-im-relay/core build`
- `pnpm --filter @agent-im-relay/feishu build`

Expected: PASS.

**Step 3: Add or adjust scripts**

Make the managed gateway and local client startup modes easy to run, for example with dedicated `dev` scripts.

**Step 4: Re-run verification**

Run:

- `pnpm --filter @agent-im-relay/core test`
- `pnpm --filter @agent-im-relay/discord test`
- `pnpm --filter @agent-im-relay/feishu test`
- `pnpm --filter @agent-im-relay/feishu build`

Expected: PASS.

**Step 5: Commit**

```bash
git add package.json packages/feishu/package.json
git commit -m "chore(feishu): wire managed gateway scripts"
```
