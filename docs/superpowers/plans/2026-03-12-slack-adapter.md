# Slack Adapter Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-party Slack platform package with Socket Mode, thread-first conversation handling, Block Kit backend/model selection, slash commands, Slack markdown formatting, and core Slack platform registration.

**Architecture:** Build a dedicated `packages/slack` package that mirrors the existing Discord/Feishu package split: config/bootstrap, runtime/event routing, adapter, conversation helpers, cards, formatting, and focused tests. Keep core changes small and explicit by registering Slack as a relay platform, extending persistence/path helpers for Slack state, and only extracting Feishu run-gating logic when the shared boundary is transport-agnostic.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, `@slack/bolt`, Block Kit, existing `@agent-im-relay/core`

---

## Chunk 1: Core Slack platform plumbing

### Task 1: Make core recognize Slack conversations and scoped Slack state

**Files:**
- Modify: `packages/core/src/relay-platform.ts`
- Modify: `packages/core/src/paths.ts`
- Modify: `packages/core/src/__tests__/persist.test.ts`
- Modify: `packages/core/src/__tests__/config.test.ts` or add a new focused test file if path helpers need direct coverage

- [ ] **Step 1: Write the failing core tests**

Add tests that prove:
- `relayPlatforms` includes `slack`
- Slack conversation ids are inferable without colliding with legacy Discord numeric ids or Feishu ids
- Slack-scoped state loads/saves preserve other platform state in the shared `sessions.json`
- Slack helper paths resolve to sibling files/directories under the existing relay state directory

- [ ] **Step 2: Run the targeted core tests to verify they fail**

Run: `pnpm vitest run packages/core/src/__tests__/persist.test.ts packages/core/src/__tests__/config.test.ts`
Expected: FAIL because Slack is not yet a known relay platform and no Slack-specific path helper exists.

- [ ] **Step 3: Write the minimal core implementation**

Implement the smallest possible core changes:
- add `'slack'` to `relayPlatforms`
- teach `inferRelayPlatformFromConversationId()` to recognize the Slack conversation id format chosen for the new adapter
- add any Slack-specific path helper needed for package-local persistence files
- preserve scoped save/load behavior in `persist.ts` so Slack state coexists with Discord and Feishu state

- [ ] **Step 4: Run the targeted core tests to verify they pass**

Run: `pnpm vitest run packages/core/src/__tests__/persist.test.ts packages/core/src/__tests__/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the core plumbing slice**

```bash
git add packages/core/src/relay-platform.ts packages/core/src/paths.ts packages/core/src/__tests__/persist.test.ts packages/core/src/__tests__/config.test.ts
git commit -m "feat(core): register slack relay platform"
```

## Chunk 2: Scaffold the Slack package and its pure helpers

### Task 2: Add package bootstrap, config parsing, formatting, and Block Kit builders

**Files:**
- Create: `packages/slack/package.json`
- Create: `packages/slack/tsconfig.json`
- Create: `packages/slack/tsdown.config.ts`
- Create: `packages/slack/vitest.config.ts`
- Create: `packages/slack/src/index.ts`
- Create: `packages/slack/src/config.ts`
- Create: `packages/slack/src/cards.ts`
- Create: `packages/slack/src/formatting.ts`
- Create: `packages/slack/src/__tests__/config.test.ts`
- Create: `packages/slack/src/__tests__/cards.test.ts`
- Create: `packages/slack/src/__tests__/formatting.test.ts`

- [ ] **Step 1: Write the failing Slack helper tests**

Cover these behaviors first:
- config parsing for bot token, app token, signing secret, and Socket Mode defaults
- Slack-local state-file helper paths
- backend/model Block Kit payload shape
- Markdown -> Slack `mrkdwn` conversion for headings, links, code fences, lists, and table fallback

- [ ] **Step 2: Run the helper tests to verify they fail**

Run: `pnpm vitest run packages/slack/src/__tests__/config.test.ts packages/slack/src/__tests__/cards.test.ts packages/slack/src/__tests__/formatting.test.ts`
Expected: FAIL because `packages/slack` does not exist yet.

- [ ] **Step 3: Write the minimal Slack package and helper implementation**

Create the new package using the same build/test conventions as `packages/discord` and `packages/feishu`:
- package metadata and workspace dependency on `@agent-im-relay/core`
- `@slack/bolt` as the runtime dependency for Socket Mode, slash commands, actions, and events
- config helpers that layer Slack env vars over core config
- pure Block Kit builders for backend/model selection and status/control messages
- a conservative Markdown formatter that outputs readable Slack `mrkdwn`

- [ ] **Step 4: Run the helper tests to verify they pass**

Run: `pnpm vitest run packages/slack/src/__tests__/config.test.ts packages/slack/src/__tests__/cards.test.ts packages/slack/src/__tests__/formatting.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the Slack helper slice**

```bash
git add packages/slack/package.json packages/slack/tsconfig.json packages/slack/tsdown.config.ts packages/slack/vitest.config.ts packages/slack/src/index.ts packages/slack/src/config.ts packages/slack/src/cards.ts packages/slack/src/formatting.ts packages/slack/src/__tests__/config.test.ts packages/slack/src/__tests__/cards.test.ts packages/slack/src/__tests__/formatting.test.ts
git commit -m "feat(slack): add package scaffolding and helpers"
```

## Chunk 3: Implement the adapter and thread-mapping layer

### Task 3: Cover Slack adapter capabilities and conversation filtering

**Files:**
- Create: `packages/slack/src/adapter.ts`
- Create: `packages/slack/src/conversation.ts`
- Create: `packages/slack/src/state.ts`
- Create: `packages/slack/src/__tests__/adapter.test.ts`
- Create: `packages/slack/src/__tests__/conversation.test.ts`
- Modify: `packages/slack/src/index.ts`

- [ ] **Step 1: Write the failing adapter and conversation tests**

Add tests for:
- `MessageSender.send()` / `edit()` targeting a Slack thread with optional `blocks`
- `ConversationManager.createConversation()` always creating a new thread for `/code` and `/ask`
- `ConversationManager.getConversationId()` resolving only mapped active conversation threads
- `StatusIndicator` updating visible thread status state
- `InteractiveUI` waiting on Block Kit selection state without accepting unrelated actions
- message filtering rules: slash commands global, ordinary messages only in mapped conversation threads, bot-authored messages ignored

- [ ] **Step 2: Run the targeted adapter tests to verify they fail**

Run: `pnpm vitest run packages/slack/src/__tests__/adapter.test.ts packages/slack/src/__tests__/conversation.test.ts`
Expected: FAIL because the adapter, conversation mapper, and Slack state store are not implemented.

- [ ] **Step 3: Write the minimal adapter implementation**

Implement:
- a Slack conversation id format based on the created thread root timestamp, with enough side-state to recover channel id and root message ts
- a small persisted Slack state store for thread mappings, pending UI state, and any card message ids needed for in-place updates
- adapter implementations for `MessageSender`, `ConversationManager`, `StatusIndicator`, `InteractiveUI`, and `MarkdownFormatter`
- exports from `packages/slack/src/index.ts` that match the package conventions used elsewhere

- [ ] **Step 4: Run the targeted adapter tests to verify they pass**

Run: `pnpm vitest run packages/slack/src/__tests__/adapter.test.ts packages/slack/src/__tests__/conversation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the adapter slice**

```bash
git add packages/slack/src/index.ts packages/slack/src/adapter.ts packages/slack/src/conversation.ts packages/slack/src/state.ts packages/slack/src/__tests__/adapter.test.ts packages/slack/src/__tests__/conversation.test.ts
git commit -m "feat(slack): add adapter and thread mapping"
```

## Chunk 4: Implement Socket Mode runtime, slash commands, and run gating

### Task 4: Handle Slack events, Block Kit interactions, and pending runs end-to-end

**Files:**
- Create: `packages/slack/src/runtime.ts`
- Create: `packages/slack/src/commands/code.ts`
- Create: `packages/slack/src/commands/ask.ts`
- Create: `packages/slack/src/commands/interrupt.ts`
- Create: `packages/slack/src/commands/done.ts`
- Create: `packages/slack/src/commands/skill.ts`
- Create: `packages/slack/src/__tests__/runtime.test.ts`
- Create: `packages/slack/src/__tests__/commands.test.ts`
- Modify: `packages/slack/src/state.ts`
- Modify: `packages/slack/src/cards.ts`
- Modify: `packages/slack/src/index.ts`
- Modify: `packages/core/src/index.ts` if new core helpers are extracted for shared run gating
- Modify: `packages/feishu/src/runtime.ts` and related tests only if a clearly shared helper is extracted and Feishu behavior is preserved

- [ ] **Step 1: Write the failing runtime and command tests**

Cover:
- Socket Mode slash-command ack + async thread creation
- `/code` and `/ask` always creating a fresh thread, even when invoked from an existing thread
- `/interrupt`, `/done`, and `/skill` operating only on mapped conversations
- backend/model gate behavior with a single pending run per conversation
- model-selection timeout resuming the pending run when a safe default exists
- in-place Block Kit card updates after backend/model choice
- ordinary thread replies resuming the mapped conversation

- [ ] **Step 2: Run the targeted runtime tests to verify they fail**

Run: `pnpm vitest run packages/slack/src/__tests__/runtime.test.ts packages/slack/src/__tests__/commands.test.ts`
Expected: FAIL because the Slack runtime, command dispatch, and pending-run flow are not implemented.

- [ ] **Step 3: Write the minimal runtime implementation**

Build the runtime around `@slack/bolt` Socket Mode primitives:
- bootstrap a Bolt `App` configured for Socket Mode
- register slash commands, event listeners, and action handlers
- create a new Slack thread for `/code` and `/ask`, persist the mapping, then dispatch the run through core
- enforce the message filter rules for ordinary Slack messages
- reuse Feishu-style pending-run/model-selection semantics where the code can be shared cleanly; otherwise mirror the behavior locally with identical tests
- clean up pending runs, timers, and visible card state on `/interrupt` and `/done`

- [ ] **Step 4: Run the targeted runtime tests to verify they pass**

Run: `pnpm vitest run packages/slack/src/__tests__/runtime.test.ts packages/slack/src/__tests__/commands.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the runtime slice**

```bash
git add packages/slack/src/runtime.ts packages/slack/src/commands/code.ts packages/slack/src/commands/ask.ts packages/slack/src/commands/interrupt.ts packages/slack/src/commands/done.ts packages/slack/src/commands/skill.ts packages/slack/src/state.ts packages/slack/src/cards.ts packages/slack/src/index.ts packages/slack/src/__tests__/runtime.test.ts packages/slack/src/__tests__/commands.test.ts packages/core/src/index.ts packages/feishu/src/runtime.ts
git commit -m "feat(slack): add socket mode runtime"
```

## Chunk 5: Verify integration, docs, and PR readiness

### Task 5: Prove Slack is integrated without regressing accepted baselines

**Files:**
- Modify: `docs/superpowers/specs/2026-03-12-slack-adapter-design.md`
- Modify: `docs/superpowers/plans/2026-03-12-slack-adapter.md`
- Modify: any implementation and test files touched above

- [ ] **Step 1: Run the focused green suite**

Run: `pnpm vitest run packages/core/src/__tests__/persist.test.ts packages/slack/src/__tests__/config.test.ts packages/slack/src/__tests__/cards.test.ts packages/slack/src/__tests__/formatting.test.ts packages/slack/src/__tests__/adapter.test.ts packages/slack/src/__tests__/conversation.test.ts packages/slack/src/__tests__/runtime.test.ts packages/slack/src/__tests__/commands.test.ts packages/feishu/src/__tests__/runtime.test.ts`
Expected: PASS

- [ ] **Step 2: Run package-level verification**

Run:
- `pnpm --filter @agent-im-relay/core test`
- `pnpm --filter @agent-im-relay/slack test`
- `pnpm --filter @agent-im-relay/feishu test`
Expected: PASS

Note: The repository currently has an accepted pre-existing red baseline in `packages/discord/src/__tests__/index.test.ts`. Do not claim a fully green workspace unless those known Discord failures are separately addressed.

- [ ] **Step 3: Run build verification**

Run:
- `pnpm --filter @agent-im-relay/core build`
- `pnpm --filter @agent-im-relay/slack build`
- `pnpm --filter @agent-im-relay/feishu build`
Expected: PASS

- [ ] **Step 4: Review the diff and write the PR summary**

Run:
- `git diff --stat`
- `git diff -- packages/core packages/slack packages/feishu docs/superpowers`
Expected: Only Slack-related platform, shared gating, and documentation changes appear.

Prepare the PR notes with:
- Slack package overview
- core registration/state updates
- pending-run/model-selection behavior
- verification results and the accepted known Discord baseline failure

- [ ] **Step 5: Create the final commit, push, and open the PR**

```bash
git add packages/core packages/slack packages/feishu docs/superpowers
git commit -m "feat: add slack relay adapter"
git push -u origin feat/slack-adapter
gh pr create --fill
```
