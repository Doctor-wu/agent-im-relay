# Message Control Tags Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let incoming Discord and Feishu messages switch the conversation backend through core-level control tags such as `<set-backend>codex</set-backend>`, with optional prompt text in the same message.

**Architecture:** Introduce a small core preprocessing module that extracts supported control tags into `SessionControlCommand` values and returns the cleaned prompt. Wire both Discord and Feishu ingress through that module so transport packages only apply controller effects and decide whether a prompt remains to run.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, existing `@agent-im-relay/core`, `@agent-im-relay/discord`, `@agent-im-relay/feishu`

---

### Task 1: Add core preprocessing contract

**Files:**
- Create: `packages/core/src/platform/message-preprocessing.ts`
- Create: `packages/core/src/platform/__tests__/message-preprocessing.test.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write the failing test**

- Add tests for:
  - standalone `<set-backend>codex</set-backend>`
  - mixed control tag plus prompt
  - multiple tags where the last valid backend wins
  - invalid backend tags preserved as plain prompt text

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/platform/__tests__/message-preprocessing.test.ts`
Expected: FAIL because the preprocessing module does not exist yet

**Step 3: Write minimal implementation**

- Parse supported backend tags
- Return normalized message control directives plus the cleaned prompt
- Add a shared helper that applies those directives through the session-control controller and auto-confirms backend changes
- Export the new helpers from `packages/core/src/index.ts`

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/platform/__tests__/message-preprocessing.test.ts`
Expected: PASS

### Task 2: Integrate preprocessing into Discord ingress

**Files:**
- Modify: `packages/discord/src/index.ts`
- Modify: `packages/discord/src/conversation.ts`
- Modify: `packages/discord/src/__tests__/conversation.test.ts`

**Step 1: Write the failing test**

- Add a regression test showing that a mixed message updates backend before calling `runPlatformConversation()`
- Add a regression test showing that a pure control-tag message persists backend state and skips conversation execution

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/conversation.test.ts`
Expected: FAIL because Discord does not yet preprocess message control tags

**Step 3: Write minimal implementation**

- Preprocess incoming prompt text through core
- Apply returned commands with persistence effects
- Only call `runMentionConversation()` when a cleaned prompt remains

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/conversation.test.ts`
Expected: PASS

### Task 3: Integrate preprocessing into Feishu ingress

**Files:**
- Modify: `packages/feishu/src/runtime.ts`
- Modify: `packages/feishu/src/events.ts`
- Modify: `packages/feishu/src/__tests__/backend-gate.test.ts`

**Step 1: Write the failing test**

- Add a regression test showing a standalone control-tag message updates backend and does not request backend-selection UI
- Add a regression test showing a mixed message updates backend and continues with the cleaned prompt

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/backend-gate.test.ts`
Expected: FAIL because Feishu does not yet preprocess text control tags

**Step 3: Write minimal implementation**

- Preprocess message text in the Feishu message path
- Apply returned commands before backend gating
- Skip run dispatch when only control tags remain

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/backend-gate.test.ts`
Expected: PASS

### Task 4: Run focused verification

**Files:**
- Modify: `docs/plans/2026-03-10-message-control-tags-design.md`
- Modify: `docs/plans/2026-03-10-message-control-tags.md`

**Step 1: Run focused test suites**

Run:

- `pnpm --filter @agent-im-relay/core test -- --run src/platform/__tests__/message-preprocessing.test.ts`
- `pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/conversation.test.ts`
- `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/backend-gate.test.ts`

Expected: PASS

**Step 2: Run broader verification**

Run:

- `pnpm --filter @agent-im-relay/core test`
- `pnpm --filter @agent-im-relay/discord test`
- `pnpm --filter @agent-im-relay/feishu test`

Expected: PASS

**Step 3: Update docs if implementation details changed**

- Keep the design and plan aligned with the actual file paths and behavior
