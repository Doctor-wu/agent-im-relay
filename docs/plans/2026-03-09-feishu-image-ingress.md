# Feishu Image Ingress Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Feishu image-bearing messages reach the shared attachment pipeline instead of being rejected as missing prompts.

**Architecture:** Keep all behavior changes inside `packages/feishu`. Expand inbound message parsing so the event router can extract prompt text and attachments from `file`, `image`, and `post` payloads, then keep using the existing runtime attachment queue and core download pipeline.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, Feishu adapter package

---

### Task 1: Add failing Feishu ingress regression tests

**Files:**
- Modify: `packages/feishu/src/__tests__/events.test.ts`

**Step 1: Write the failing test**

Add regression tests for:

- `message_type: "image"` queues a pending attachment and does not trigger missing-prompt text
- `message_type: "post"` extracts text plus image attachment and starts `runFeishuConversation()`

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/events.test.ts`

Expected: FAIL because current ingress parsing only understands `file` and plain `text`.

### Task 2: Implement Feishu attachment and rich-text parsing

**Files:**
- Modify: `packages/feishu/src/conversation.ts`
- Modify: `packages/feishu/src/events.ts`
- Modify: `packages/feishu/src/api.ts`

**Step 1: Write minimal implementation**

- replace the file-only helper with attachment extraction that supports `file`, `image`, and `post`
- parse text from both plain-text and `post` bodies
- pass the Feishu resource type into the download helper

**Step 2: Run targeted tests**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/events.test.ts`

Expected: PASS

### Task 3: Verify package-level safety

**Files:**
- Test: `packages/feishu/src/__tests__/events.test.ts`
- Test: `packages/feishu/src/__tests__/files.test.ts`
- Test: `packages/feishu/src/__tests__/conversation.test.ts`

**Step 1: Run focused verification**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/events.test.ts src/__tests__/files.test.ts src/__tests__/conversation.test.ts`

Expected: PASS
