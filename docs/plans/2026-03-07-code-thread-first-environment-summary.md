# Code Thread First Environment Summary Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `/code` follow the same first-run environment summary rule as thread conversations.

**Architecture:** Reuse the existing Discord conversation pipeline instead of streaming `/code` output directly. `handleCodeCommand()` should create or reuse the code thread, post the prompt header, then delegate to `runMentionConversation()`, which already decides whether environment should be shown based on the presence of a saved session.

**Tech Stack:** TypeScript, Vitest, discord.js, workspace package `@agent-im-relay/core`

---

### Task 1: Route `/code` through the shared conversation runner

**Files:**
- Modify: `agent-im-relay/packages/discord/src/commands/code.ts`
- Test: `agent-im-relay/packages/discord/src/__tests__/code.test.ts`

**Step 1: Write the failing test**

- Add a test that verifies `/code` delegates to `runMentionConversation()`
- Add a test that verifies a busy thread returns a user-facing message instead of starting a second run

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/code.test.ts`

**Step 3: Write minimal implementation**

- Remove direct `streamAgentSession()` usage from `/code`
- Call `runMentionConversation()` after creating the thread and posting the prompt marker
- Handle the boolean return to report a busy thread cleanly

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/code.test.ts`

### Task 2: Verify the Discord package

**Files:**
- Test: `agent-im-relay/packages/discord/src/__tests__/code.test.ts`

**Step 1: Run package verification**

Run: `pnpm --filter @agent-im-relay/discord test`

**Step 2: If green, stop**

- Do not broaden scope unless verification reveals a regression.
