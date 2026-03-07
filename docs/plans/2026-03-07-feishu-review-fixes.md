# Feishu Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the review findings in the Feishu foundation patch without expanding scope into a full Feishu adapter implementation.

**Architecture:** Tighten callback validation inside `packages/feishu/src/security.ts`, make deduplication succeed only after successful event handling, and replace the placeholder startup export with a minimal long-running HTTP server that proves the package can boot independently. Guard the changes with focused Vitest coverage.

**Tech Stack:** TypeScript, Node.js HTTP server, Vitest, pnpm workspace

---

### Task 1: Lock callback behavior with regression tests

**Files:**
- Modify: `packages/feishu/src/__tests__/security.test.ts`

**Step 1: Write the failing tests**

- Add a test that missing Feishu signing headers are rejected.
- Add a test that a failing `runEvent` call does not permanently mark the event as processed.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test`
Expected: FAIL in the new callback tests.

### Task 2: Make the Feishu entrypoint actually boot

**Files:**
- Modify: `packages/feishu/src/index.ts`
- Modify: `packages/feishu/src/__tests__/config.test.ts`

**Step 1: Write the failing test**

- Add a test that `createFeishuServer().start()` binds an HTTP port and exposes a basic health response.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test`
Expected: FAIL because startup is currently a placeholder.

### Task 3: Implement the minimal fixes

**Files:**
- Modify: `packages/feishu/src/security.ts`
- Modify: `packages/feishu/src/index.ts`

**Step 1: Fix callback security**

- Reject missing signature headers.
- Only retain processed event IDs after `runEvent` succeeds.

**Step 2: Fix startup behavior**

- Start a small Node HTTP server.
- Return `200 OK` on `/healthz`.
- Keep explicit placeholder behavior for unimplemented Feishu routes without crashing startup.

### Task 4: Verify

**Files:**
- Test: `packages/feishu/src/__tests__/security.test.ts`
- Test: `packages/feishu/src/__tests__/config.test.ts`

**Step 1: Run focused tests**

Run: `pnpm --filter @agent-im-relay/feishu test`
Expected: PASS

**Step 2: Run build**

Run: `pnpm --filter @agent-im-relay/feishu build`
Expected: PASS

**Step 3: Run regression checks on shared packages**

Run: `pnpm --filter @agent-im-relay/core test`
Run: `pnpm --filter @agent-im-relay/discord test`
Expected: PASS
