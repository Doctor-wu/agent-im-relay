# Slack Experience V2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the five requested Slack experience upgrades plus the existing Slack package import fix in one branch and PR.

**Architecture:** Keep core untouched except where already required by the existing Slack package contract. Implement Slack changes inside `packages/slack` by splitting runtime behavior into routing, launch, and presentation helpers, then wire `apps/agent-inbox` back to a resolvable Slack package entry.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, `@slack/bolt`, existing `@agent-im-relay/core`

---

## Chunk 1: Lock the current Slack baseline with tests

### Task 1: Add failing tests for routing and package-entry gaps

**Files:**
- Modify: `packages/slack/src/__tests__/runtime.test.ts`
- Modify: `packages/slack/src/__tests__/conversation.test.ts`
- Modify: `apps/agent-inbox/src/__tests__/runtime.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests for:
- channel root `app_mention` starts a new Slack conversation bound to the mention message thread
- mention inside an already mapped thread continues instead of creating a new conversation
- DM message starts a Slack conversation without calling `createThread`
- `apps/agent-inbox` can dynamically import `@agent-im-relay/slack` during tests

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:
- `pnpm vitest run packages/slack/src/__tests__/runtime.test.ts packages/slack/src/__tests__/conversation.test.ts`
- `pnpm vitest run apps/agent-inbox/src/__tests__/runtime.test.ts`

Expected:
- Slack runtime tests fail because mention and DM routing are incomplete
- agent-inbox runtime test fails because `@agent-im-relay/slack` package entry is not resolvable

- [ ] **Step 3: Commit the red baseline when the tests clearly fail for the right reason**

```bash
git add packages/slack/src/__tests__/runtime.test.ts packages/slack/src/__tests__/conversation.test.ts apps/agent-inbox/src/__tests__/runtime.test.ts
git commit -m "test(slack): cover mention dm and package entry gaps"
```

## Chunk 2: Implement routing and conversation state

### Task 2: Build channel mention and DM routing

**Files:**
- Modify: `packages/slack/src/runtime.ts`
- Modify: `packages/slack/src/conversation.ts`
- Modify: `packages/slack/src/state.ts`
- Modify: `packages/slack/src/index.ts`

- [ ] **Step 1: Implement the smallest routing changes**

Implement:
- an `app_mention` handler registered from runtime startup
- root-message mention startup that uses the source message timestamp as `threadTs`
- mapped-thread continuation for in-thread mentions and messages
- DM first-message startup and DM continuation
- state metadata for `containerType` and pending-run source

- [ ] **Step 2: Run the targeted Slack tests**

Run: `pnpm vitest run packages/slack/src/__tests__/runtime.test.ts packages/slack/src/__tests__/conversation.test.ts`
Expected: PASS

- [ ] **Step 3: Commit the routing slice**

```bash
git add packages/slack/src/runtime.ts packages/slack/src/conversation.ts packages/slack/src/state.ts packages/slack/src/index.ts packages/slack/src/__tests__/runtime.test.ts packages/slack/src/__tests__/conversation.test.ts
git commit -m "feat(slack): support mentions and dm routing"
```

## Chunk 3: Implement presence, reactions, and streaming

### Task 3: Align Slack runtime feedback with Discord

**Files:**
- Modify: `packages/slack/src/runtime.ts`
- Create: `packages/slack/src/presentation.ts`
- Create: `packages/slack/src/stream.ts`
- Modify: `packages/slack/src/__tests__/runtime.test.ts`
- Create: `packages/slack/src/__tests__/stream.test.ts`

- [ ] **Step 1: Write or extend failing presentation tests**

Cover:
- startup presence calls `users.setPresence` with `auto`
- reactions advance through `received`, `thinking`, `tool_running`, `done`, and `error`
- stream output updates a single Slack message incrementally
- update failures fall back to ordinary message posting

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `pnpm vitest run packages/slack/src/__tests__/runtime.test.ts packages/slack/src/__tests__/stream.test.ts`
Expected: FAIL because presence, reaction, and streaming behaviors are missing

- [ ] **Step 3: Implement the minimal presentation layer**

Implement:
- startup presence update in runtime bootstrap
- reaction helpers that no-op safely when Slack rejects reactions
- streaming message lifecycle modeled after Discord semantics, but using Slack `chat.postMessage` and `chat.update`

- [ ] **Step 4: Re-run the targeted tests**

Run: `pnpm vitest run packages/slack/src/__tests__/runtime.test.ts packages/slack/src/__tests__/stream.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the presentation slice**

```bash
git add packages/slack/src/runtime.ts packages/slack/src/presentation.ts packages/slack/src/stream.ts packages/slack/src/__tests__/runtime.test.ts packages/slack/src/__tests__/stream.test.ts
git commit -m "feat(slack): add presence reactions and streaming"
```

## Chunk 4: Fix package resolution and DM slash-command flow

### Task 4: Make Slack loadable from agent-inbox and complete DM slash handling

**Files:**
- Modify: `packages/slack/package.json`
- Modify: `packages/slack/tsdown.config.ts`
- Modify: `apps/agent-inbox/src/runtime.ts` only if a loader fallback is needed
- Modify: `packages/slack/src/runtime.ts`
- Modify: `packages/slack/src/__tests__/runtime.test.ts`
- Modify: `apps/agent-inbox/src/__tests__/runtime.test.ts`

- [ ] **Step 1: Write the failing DM slash-command test if it is not already covered**

Cover:
- `/code` and `/ask` in DM create a root bot message and then continue through normal Slack thread handling
- `apps/agent-inbox` can import and start the Slack runtime in tests

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:
- `pnpm vitest run packages/slack/src/__tests__/runtime.test.ts`
- `pnpm vitest run apps/agent-inbox/src/__tests__/runtime.test.ts`

Expected: FAIL until the package entry and DM slash flow are fixed

- [ ] **Step 3: Implement the minimal import and DM slash fix**

Implement:
- package exports that resolve both in the built package and in workspace test/dev usage
- DM slash-command root-message creation and conversation mapping
- any minimal agent-inbox loader adjustment only if package metadata alone is insufficient

- [ ] **Step 4: Re-run the targeted tests**

Run:
- `pnpm vitest run packages/slack/src/__tests__/runtime.test.ts`
- `pnpm vitest run apps/agent-inbox/src/__tests__/runtime.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the integration slice**

```bash
git add packages/slack/package.json packages/slack/tsdown.config.ts apps/agent-inbox/src/runtime.ts packages/slack/src/runtime.ts packages/slack/src/__tests__/runtime.test.ts apps/agent-inbox/src/__tests__/runtime.test.ts
git commit -m "fix(slack): resolve package entry and dm slash flow"
```

## Chunk 5: Full verification and PR prep

### Task 5: Verify the branch end to end

**Files:**
- Modify: any files touched above

- [ ] **Step 1: Run focused Slack and inbox tests**

Run:
- `pnpm vitest run packages/slack/src/__tests__/runtime.test.ts packages/slack/src/__tests__/conversation.test.ts packages/slack/src/__tests__/stream.test.ts apps/agent-inbox/src/__tests__/runtime.test.ts`

Expected: PASS

- [ ] **Step 2: Run package-level verification**

Run:
- `pnpm --filter @agent-im-relay/slack test`
- `pnpm --filter @doctorwu/agent-inbox test`

Expected: PASS

- [ ] **Step 3: Run workspace verification**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 4: Build the affected packages**

Run:
- `pnpm --filter @agent-im-relay/slack build`
- `pnpm --filter @doctorwu/agent-inbox build`

Expected: PASS

- [ ] **Step 5: Prepare branch for review**

```bash
git status --short
git log --oneline --decorate -5
gh pr create --base main --head feat/slack-experience-v2 --title "feat: improve slack bot experience" --body-file .github/pull_request_template.md
```
