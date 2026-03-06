# Thread First Environment Summary Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Only show the environment summary for the first agent run in a Discord thread, using the absence of a saved session as the heuristic.

**Architecture:** Keep the change in the Discord package. `runMentionConversation()` decides whether the current run is the first thread run, then passes a `showEnvironment` flag into `streamAgentToDiscord()`. The streamer still consumes backend `environment` events for internal flow compatibility, but only renders them when the flag is enabled.

**Tech Stack:** TypeScript, Vitest, discord.js, workspace package `@agent-im-relay/core`

---

### Task 1: Gate environment rendering in the Discord streamer

**Files:**
- Modify: `agent-im-relay/packages/discord/src/stream.ts`
- Test: `agent-im-relay/packages/discord/src/__tests__/stream.test.ts`

**Step 1: Write the failing test**

- Add a test that calls `streamAgentToDiscord()` with `showEnvironment: false`
- Feed it an `environment` event followed by a `text` event
- Assert that no standalone environment message is sent

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/discord test -- --run packages/discord/src/__tests__/stream.test.ts`

**Step 3: Write minimal implementation**

- Extend the streamer options with `showEnvironment?: boolean`
- Default it to `false`
- Skip visible rendering for `environment` events when disabled

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/discord test -- --run packages/discord/src/__tests__/stream.test.ts`

### Task 2: Only enable environment on the first thread run

**Files:**
- Modify: `agent-im-relay/packages/discord/src/conversation.ts`
- Test: `agent-im-relay/packages/discord/src/__tests__/conversation.test.ts`

**Step 1: Write the failing test**

- Add a test for a brand-new thread with no saved session and assert `showEnvironment: true`
- Add a test for an existing thread with a saved session and assert `showEnvironment: false`

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/discord test -- --run packages/discord/src/__tests__/conversation.test.ts`

**Step 3: Write minimal implementation**

- In `runMentionConversation()`, compute `showEnvironment` from `!existingSessionId`
- Pass the flag through to `streamAgentToDiscord()`

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/discord test -- --run packages/discord/src/__tests__/conversation.test.ts`

### Task 3: Verify the focused Discord test suite

**Files:**
- Test: `agent-im-relay/packages/discord/src/__tests__/stream.test.ts`
- Test: `agent-im-relay/packages/discord/src/__tests__/conversation.test.ts`

**Step 1: Run focused verification**

Run: `pnpm --filter @agent-im-relay/discord test -- --run packages/discord/src/__tests__/stream.test.ts packages/discord/src/__tests__/conversation.test.ts`

**Step 2: If green, stop**

- Do not broaden the scope unless these tests reveal adjacent regressions.
