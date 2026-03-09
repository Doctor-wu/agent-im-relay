# Feishu Rich Text Rendering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Feishu agent replies readable by routing outbound textual content through a Feishu rich-text formatter and sending structured replies as `post` messages with safe plain-text fallback.

**Architecture:** Keep the change local to `packages/feishu`. Add a formatter module that converts outbound text into Feishu `post` paragraphs, extend the Feishu API client to send/reply with `post`, and update the Feishu transport so all textual output flows through that formatter before delivery. Preserve existing cards, files, and shared-chat flows, plus the local error-handling edits already present in `packages/feishu/src/events.ts`.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, Feishu adapter package

---

### Task 1: Add failing formatter regression tests

**Files:**
- Create: `packages/feishu/src/__tests__/formatting.test.ts`
- Create: `packages/feishu/src/formatting.ts`

**Step 1: Write the failing test**

Add formatter tests that prove:

- long multi-paragraph output becomes Feishu `post` content with one visible paragraph per section
- markdown headings and label-like lines become emphasized standalone paragraphs
- list items stay separated
- quote lines stay grouped
- fenced code block content triggers plain-text fallback

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/formatting.test.ts`

Expected: FAIL because `packages/feishu/src/formatting.ts` does not exist yet.

**Step 3: Write minimal implementation**

Create `packages/feishu/src/formatting.ts` with:

- a formatter result type describing `post` vs `text` fallback
- paragraph splitting and normalization helpers
- heading/list/quote handling
- code-fence detection and fallback

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/formatting.test.ts`

Expected: PASS

### Task 2: Add failing Feishu API transport tests for `post`

**Files:**
- Modify: `packages/feishu/src/__tests__/api.test.ts`
- Modify: `packages/feishu/src/api.ts`

**Step 1: Write the failing test**

Add API tests proving:

- `sendMessage()` accepts `msgType: "post"`
- `replyMessage()` accepts `msgType: "post"`
- the correct serialized Feishu payload reaches the HTTP layer

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/api.test.ts`

Expected: FAIL because the client type definitions only allow the current message kinds or because no `post` use case is covered.

**Step 3: Write minimal implementation**

Update `packages/feishu/src/api.ts` so text transport helpers can send and reply with `msg_type: "post"` in addition to existing message kinds.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/api.test.ts`

Expected: PASS

### Task 3: Route outbound Feishu text through the formatter

**Files:**
- Modify: `packages/feishu/src/events.ts`
- Modify: `packages/feishu/src/formatting.ts`
- Test: `packages/feishu/src/__tests__/events.test.ts`

**Step 1: Write the failing test**

Add router/transport tests showing:

- structured long-form replies are sent as `post`
- reply-path delivery still prefers reply API before chat send fallback
- fenced code output still uses plain `text`

Keep the tests compatible with the current local edits in `packages/feishu/src/events.ts`.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/events.test.ts`

Expected: FAIL because the transport still serializes all textual content as plain text.

**Step 3: Write minimal implementation**

Update the Feishu transport in `packages/feishu/src/events.ts` so:

- all textual output enters the new formatter
- formatter `post` output is sent with `msg_type: "post"`
- fallback output stays on `msg_type: "text"`
- existing file/card behavior and current local try/catch handling remain intact

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/events.test.ts`

Expected: PASS

### Task 4: Verify Feishu package safety

**Files:**
- Test: `packages/feishu/src/__tests__/formatting.test.ts`
- Test: `packages/feishu/src/__tests__/api.test.ts`
- Test: `packages/feishu/src/__tests__/events.test.ts`
- Test: `packages/feishu/src/__tests__/runtime.test.ts`
- Test: `packages/feishu/src/__tests__/conversation.test.ts`

**Step 1: Run focused verification**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/formatting.test.ts src/__tests__/api.test.ts src/__tests__/events.test.ts src/__tests__/runtime.test.ts src/__tests__/conversation.test.ts`

Expected: PASS

**Step 2: Run package verification**

Run: `pnpm --filter @agent-im-relay/feishu test`

Expected: PASS

**Step 3: Run build verification**

Run: `pnpm --filter @agent-im-relay/feishu build`

Expected: PASS
