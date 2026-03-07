# Platform Conversation Orchestration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a shared core orchestration layer for platform conversations and wire Feishu onto it while keeping Discord behavior intact.

**Architecture:** Extract platform-neutral conversation request evaluation, control action semantics, and a high-level execution wrapper into `@agent-im-relay/core`. Refactor Discord to consume that wrapper, then build the Feishu HTTP/API adapter on top of the same shared boundary.

**Tech Stack:** TypeScript, Node.js HTTP server, Fetch API, Vitest, pnpm workspace

---

### Task 1: Extract shared action and setup semantics into core

**Files:**
- Create: `packages/core/src/platform/conversation.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/state.ts`
- Test: `packages/core/src/platform/__tests__/conversation.test.ts`

**Step 1: Write the failing tests**

- Add tests for backend gating when no backend exists.
- Add tests for `interrupt`, `done`, `backend`, `confirm-backend`, `cancel-backend`, `model`, and `effort`.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core exec vitest run src/platform/__tests__/conversation.test.ts`
Expected: FAIL because the shared orchestration module does not exist.

**Step 3: Write minimal implementation**

- Implement normalized run request evaluation.
- Implement normalized control action application.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core exec vitest run src/platform/__tests__/conversation.test.ts`
Expected: PASS

### Task 2: Extract shared execution wrapper into core

**Files:**
- Modify: `packages/core/src/platform/conversation.ts`
- Modify: `packages/core/src/runtime/conversation-runner.ts`
- Test: `packages/core/src/platform/__tests__/execution.test.ts`

**Step 1: Write the failing tests**

- Add tests for attachment prompt preparation and artifact publishing through the new wrapper.
- Add tests for phase callback propagation.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core exec vitest run src/platform/__tests__/execution.test.ts`
Expected: FAIL because the wrapper does not exist yet.

**Step 3: Write minimal implementation**

- Add `runPlatformConversation`.
- Reuse the existing runner and shared file helpers.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core exec vitest run src/platform/__tests__/execution.test.ts`
Expected: PASS

### Task 3: Refactor Discord to consume the shared wrapper

**Files:**
- Modify: `packages/discord/src/conversation.ts`
- Modify: `packages/discord/src/__tests__/conversation.test.ts`

**Step 1: Write the failing test**

- Update/add regression coverage so Discord proves it uses the shared wrapper for execution and still preserves reactions and attachments.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/discord exec vitest run src/__tests__/conversation.test.ts`
Expected: FAIL until the refactor is complete.

**Step 3: Write minimal implementation**

- Replace duplicated orchestration glue with the new core helper.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/discord exec vitest run src/__tests__/conversation.test.ts`
Expected: PASS

### Task 4: Build Feishu transport on the shared core boundary

**Files:**
- Create: `packages/feishu/src/api.ts`
- Create: `packages/feishu/src/server.ts`
- Modify: `packages/feishu/src/index.ts`
- Modify: `packages/feishu/src/runtime.ts`
- Modify: `packages/feishu/src/cards.ts`
- Modify: `packages/feishu/src/conversation.ts`
- Modify: `packages/feishu/src/files.ts`
- Test: `packages/feishu/src/__tests__/api.test.ts`
- Test: `packages/feishu/src/__tests__/server.test.ts`
- Test: `packages/feishu/src/__tests__/runtime.test.ts`

**Step 1: Write the failing tests**

- Add API client tests for token exchange, send message, and upload file.
- Add callback handler tests for URL verification, message receive, and card actions.
- Add runtime tests for first-run setup, resume, and action handling.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test`
Expected: FAIL because the transport and callback flow are not implemented.

**Step 3: Write minimal implementation**

- Add Feishu API client.
- Add callback handler and HTTP server route.
- Use the shared core orchestration module for execution.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test`
Expected: PASS

### Task 5: Verify the full refactor

**Files:**
- Test: `packages/core/src/platform/__tests__/conversation.test.ts`
- Test: `packages/core/src/platform/__tests__/execution.test.ts`
- Test: `packages/discord/src/__tests__/conversation.test.ts`
- Test: `packages/feishu/src/__tests__/server.test.ts`

**Step 1: Run core tests**

Run: `pnpm --filter @agent-im-relay/core test`
Expected: PASS

**Step 2: Run Discord tests**

Run: `pnpm --filter @agent-im-relay/discord test`
Expected: PASS

**Step 3: Run Feishu build and tests**

Run: `pnpm --filter @agent-im-relay/feishu test`
Run: `pnpm --filter @agent-im-relay/feishu build`
Expected: PASS
