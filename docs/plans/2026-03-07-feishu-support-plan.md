# Feishu Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Feishu adapter package with card-driven conversation controls, backend-first setup, reply-aware conversation mapping, and full file input/output support without regressing Discord.

**Architecture:** Add a new `@agent-im-relay/feishu` package for Feishu ingress, cards, files, and rendering. Extract only the minimum reusable execution helpers into `@agent-im-relay/core`, and track richer abstractions in a documented future-core ledger instead of forcing them into this round.

**Tech Stack:** TypeScript, Node.js HTTP server primitives, workspace packages `@agent-im-relay/core` and `@agent-im-relay/discord`, new workspace package `@agent-im-relay/feishu`, Vitest, `@pnpm`

---

### Task 1: Capture the future-core extraction ledger in docs

**Files:**
- Modify: `agent-im-relay/docs/plans/2026-03-07-feishu-support-design.md`
- Modify: `agent-im-relay/README.md`

**Step 1: Write the failing check**

- Add a short README section that names Feishu as planned or in-progress support
- Add a documented ledger section in the design doc for features that should later move into core

**Step 2: Run check to verify the repo is missing that wording**

Run: `rg -n "Future Core Extraction Ledger|Feishu" docs/plans/2026-03-07-feishu-support-design.md README.md`
Expected: output is incomplete or missing before the edits

**Step 3: Write minimal implementation**

- Add the future-core extraction ledger to the design doc
- Update `README.md` to mention the new Feishu package target and current implementation strategy

**Step 4: Run check to verify it passes**

Run: `rg -n "Future Core Extraction Ledger|Feishu" docs/plans/2026-03-07-feishu-support-design.md README.md`
Expected: matching lines appear in both files

### Task 2: Scaffold the Feishu workspace package

**Files:**
- Create: `agent-im-relay/packages/feishu/package.json`
- Create: `agent-im-relay/packages/feishu/tsconfig.json`
- Create: `agent-im-relay/packages/feishu/tsdown.config.ts`
- Create: `agent-im-relay/packages/feishu/vitest.config.ts`
- Create: `agent-im-relay/packages/feishu/src/index.ts`
- Create: `agent-im-relay/packages/feishu/src/config.ts`
- Create: `agent-im-relay/packages/feishu/src/__tests__/config.test.ts`
- Modify: `agent-im-relay/pnpm-workspace.yaml`
- Modify: `agent-im-relay/package.json`

**Step 1: Write the failing test**

- Add a package-level test that loads Feishu config and verifies required environment parsing
- Add a smoke test that the new package exports a startup entry without side effects

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/config.test.ts`
Expected: FAIL because the package does not exist yet

**Step 3: Write minimal implementation**

- Create the package manifest with `@agent-im-relay/core` dependency
- Add TypeScript and test config matching the workspace style
- Add a minimal startup module and config module
- Add a root script such as `dev:feishu` if the repo uses package-specific dev commands

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/config.test.ts`
Expected: PASS

### Task 3: Add Feishu conversation identity mapping

**Files:**
- Create: `agent-im-relay/packages/feishu/src/conversation.ts`
- Create: `agent-im-relay/packages/feishu/src/__tests__/conversation.test.ts`
- Modify: `agent-im-relay/packages/feishu/src/index.ts`

**Step 1: Write the failing test**

- Add tests for private chat mapping to `chat_id`
- Add tests for group replies mapping to `root_message_id`
- Add tests for group non-replies falling back to `chat_id`
- Add tests for card actions restoring `conversationId` from payload metadata

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/conversation.test.ts`
Expected: FAIL because the mapping helpers do not exist yet

**Step 3: Write minimal implementation**

- Implement a small Feishu event normalizer
- Implement `resolveConversationId()` helpers for messages and card actions
- Wire the mapping helper into the package entry layer

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/conversation.test.ts`
Expected: PASS

### Task 4: Gate first-run execution on backend selection

**Files:**
- Create: `agent-im-relay/packages/feishu/src/cards.ts`
- Create: `agent-im-relay/packages/feishu/src/runtime.ts`
- Create: `agent-im-relay/packages/feishu/src/__tests__/backend-gate.test.ts`
- Modify: `agent-im-relay/packages/core/src/state.ts`
- Modify: `agent-im-relay/packages/feishu/src/index.ts`

**Step 1: Write the failing test**

- Add a test where a new conversation cannot run until backend selection completes
- Add a test where an existing conversation reuses the saved backend without re-prompting
- Add a test where backend switching invalidates the current continuation only after user confirmation

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/backend-gate.test.ts`
Expected: FAIL because backend selection cards and gate logic do not exist yet

**Step 3: Write minimal implementation**

- Add a backend selection card payload format
- Save the selected backend into existing conversation state
- Resume normal execution only after a valid selection
- Keep the confirmation rule for explicit backend changes

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/backend-gate.test.ts`
Expected: PASS

### Task 5: Extract a platform-neutral conversation runner into core

**Files:**
- Create: `agent-im-relay/packages/core/src/runtime/conversation-runner.ts`
- Create: `agent-im-relay/packages/core/src/runtime/__tests__/conversation-runner.test.ts`
- Modify: `agent-im-relay/packages/core/src/index.ts`
- Modify: `agent-im-relay/packages/discord/src/conversation.ts`
- Modify: `agent-im-relay/packages/discord/src/__tests__/conversation.test.ts`
- Modify: `agent-im-relay/packages/feishu/src/runtime.ts`

**Step 1: Write the failing test**

- Add tests that drive one conversation run without Discord-specific thread assumptions
- Add tests that preserve session state, cwd updates, environment summary behavior, and active-run guarding
- Add a Discord regression test proving the extracted runner still satisfies current behavior

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/runtime/__tests__/conversation-runner.test.ts && pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/conversation.test.ts`
Expected: FAIL because the runner remains Discord-shaped today

**Step 3: Write minimal implementation**

- Move the reusable run lifecycle out of `packages/discord/src/conversation.ts`
- Keep platform-owned render and transport callbacks injectable
- Reuse the new runner from both Discord and Feishu

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/runtime/__tests__/conversation-runner.test.ts && pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/conversation.test.ts`
Expected: PASS

### Task 6: Reuse shared attachment and artifact staging for Feishu files

**Files:**
- Modify: `agent-im-relay/packages/core/src/artifacts/store.ts`
- Modify: `agent-im-relay/packages/core/src/artifacts/protocol.ts`
- Create: `agent-im-relay/packages/core/src/runtime/files.ts`
- Create: `agent-im-relay/packages/core/src/runtime/__tests__/files.test.ts`
- Create: `agent-im-relay/packages/feishu/src/files.ts`
- Create: `agent-im-relay/packages/feishu/src/__tests__/files.test.ts`
- Modify: `agent-im-relay/packages/feishu/src/runtime.ts`

**Step 1: Write the failing test**

- Add tests for shared attachment prompt construction
- Add tests for Feishu inbound file download into conversation storage
- Add tests for Feishu outbound artifact upload preparation and warning handling

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/runtime/__tests__/files.test.ts && pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/files.test.ts`
Expected: FAIL because the shared file helpers and Feishu file adapter do not exist yet

**Step 3: Write minimal implementation**

- Move shared attachment prompt logic into core
- Reuse the existing artifact protocol and staging flow
- Implement Feishu-specific transport for downloading user files and uploading outgoing artifacts

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/runtime/__tests__/files.test.ts && pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/files.test.ts`
Expected: PASS

### Task 7: Add card-driven session controls and explicit ask entry

**Files:**
- Modify: `agent-im-relay/packages/feishu/src/cards.ts`
- Create: `agent-im-relay/packages/feishu/src/commands/ask.ts`
- Create: `agent-im-relay/packages/feishu/src/__tests__/actions.test.ts`
- Modify: `agent-im-relay/packages/feishu/src/index.ts`
- Modify: `agent-im-relay/packages/core/src/state.ts`

**Step 1: Write the failing test**

- Add tests for card actions mapping to `interrupt`, `done`, backend switch, model switch, and effort switch
- Add tests proving ordinary messages default to `code`
- Add tests proving the explicit `ask` path does not enable code-mode artifact return instructions

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/actions.test.ts`
Expected: FAIL because the action handlers do not exist yet

**Step 3: Write minimal implementation**

- Implement card payload builders and action dispatch
- Add the explicit `ask` trigger path
- Keep ordinary messages on the default `code` path

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/actions.test.ts`
Expected: PASS

### Task 8: Add ingress hardening and retry-safe execution

**Files:**
- Create: `agent-im-relay/packages/feishu/src/security.ts`
- Create: `agent-im-relay/packages/feishu/src/__tests__/security.test.ts`
- Modify: `agent-im-relay/packages/feishu/src/index.ts`
- Modify: `agent-im-relay/packages/core/src/state.ts`

**Step 1: Write the failing test**

- Add tests for signature validation failure
- Add tests for malformed event payload rejection
- Add tests for duplicate event delivery not starting duplicate agent runs

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/security.test.ts`
Expected: FAIL because security and idempotency helpers do not exist yet

**Step 3: Write minimal implementation**

- Add signature validation for Feishu callbacks
- Add event payload guards
- Add short-lived event de-duplication keyed by Feishu event identity

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/security.test.ts`
Expected: PASS

### Task 9: Verify the workspace and document the package

**Files:**
- Modify: `agent-im-relay/README.md`
- Test: `agent-im-relay/packages/core/src/runtime/__tests__/conversation-runner.test.ts`
- Test: `agent-im-relay/packages/discord/src/__tests__/conversation.test.ts`
- Test: `agent-im-relay/packages/feishu/src/__tests__/conversation.test.ts`
- Test: `agent-im-relay/packages/feishu/src/__tests__/files.test.ts`

**Step 1: Run focused package tests**

Run: `pnpm --filter @agent-im-relay/core test`
Run: `pnpm --filter @agent-im-relay/discord test`
Run: `pnpm --filter @agent-im-relay/feishu test`

**Step 2: Run workspace verification**

Run: `pnpm test`
Expected: PASS across the workspace

**Step 3: Build the touched packages**

Run: `pnpm --filter @agent-im-relay/core build && pnpm --filter @agent-im-relay/discord build && pnpm --filter @agent-im-relay/feishu build`
Expected: PASS

**Step 4: Stop after verification**

- Do not expand scope unless verification exposes a blocker for Feishu support
