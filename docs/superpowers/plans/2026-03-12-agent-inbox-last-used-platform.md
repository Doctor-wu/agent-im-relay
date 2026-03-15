# Agent Inbox Last-Used Platform Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remember the last platform selected from `agent-inbox` startup, keep Discord first by default, and surface `Last used` on the remembered option the next time the CLI starts.

**Architecture:** Reuse the existing `apps/agent-inbox` JSONL config flow by adding one lightweight local-preference record for the startup selection. Update the CLI option builder to derive ordering and user-visible hints from that persisted value without changing the setup flow.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, `@clack/prompts`

---

## Chunk 1: Persist the startup preference in config.jsonl

### Task 1: Add config coverage for the last-used platform record

**Files:**
- Modify: `apps/agent-inbox/src/__tests__/config.test.ts`
- Modify: `apps/agent-inbox/src/config.ts`

- [ ] **Step 1: Write the failing config tests**

Add tests that:
- parse a new local-preference record and expose `lastUsedPlatform`
- ignore invalid preference values without breaking existing config parsing

- [ ] **Step 2: Run the targeted config tests to verify they fail**

Run: `pnpm --filter @doctorwu/agent-inbox vitest run src/__tests__/config.test.ts`
Expected: FAIL because the new record type is not parsed or surfaced yet.

- [ ] **Step 3: Write the minimal config implementation**

Update `apps/agent-inbox/src/config.ts` to:
- define a local-preference record for the startup platform
- parse and retain it in `records`
- expose the selected platform in the loaded config shape
- add a helper that upserts or overwrites the preference record

- [ ] **Step 4: Run the targeted config tests to verify they pass**

Run: `pnpm --filter @doctorwu/agent-inbox vitest run src/__tests__/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the config slice**

```bash
git add apps/agent-inbox/src/config.ts apps/agent-inbox/src/__tests__/config.test.ts
git commit -m "feat(agent-inbox): persist last used platform"
```

## Chunk 2: Reorder startup options and overwrite the preference

### Task 2: Cover CLI ordering and persistence first

**Files:**
- Modify: `apps/agent-inbox/src/__tests__/cli.test.ts`
- Modify: `apps/agent-inbox/src/cli.ts`
- Modify: `apps/agent-inbox/src/config.ts`

- [ ] **Step 1: Write the failing CLI tests**

Add tests that verify:
- Discord is listed first when there is no saved platform
- the saved platform moves to the top and shows `Last used`
- choosing a different platform overwrites the saved value before startup continues

- [ ] **Step 2: Run the targeted CLI tests to verify they fail**

Run: `pnpm --filter @doctorwu/agent-inbox vitest run src/__tests__/cli.test.ts`
Expected: FAIL because the CLI does not reorder options or persist the selection yet.

- [ ] **Step 3: Write the minimal CLI implementation**

Update `apps/agent-inbox/src/cli.ts` to:
- build startup options with remembered-platform priority
- keep Discord first as the default ordering
- label the remembered option with `Last used`
- persist the manual selection through `loadAppConfig/saveAppConfig` helpers before runtime launch

- [ ] **Step 4: Run the targeted CLI tests to verify they pass**

Run: `pnpm --filter @doctorwu/agent-inbox vitest run src/__tests__/cli.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the CLI slice**

```bash
git add apps/agent-inbox/src/cli.ts apps/agent-inbox/src/config.ts apps/agent-inbox/src/__tests__/cli.test.ts
git commit -m "feat(agent-inbox): reorder startup platforms by last use"
```

## Chunk 3: Final verification and delivery

### Task 3: Verify the feature end-to-end and prepare the PR

**Files:**
- Modify: `apps/agent-inbox/src/config.ts`
- Modify: `apps/agent-inbox/src/cli.ts`
- Modify: `apps/agent-inbox/src/__tests__/config.test.ts`
- Modify: `apps/agent-inbox/src/__tests__/cli.test.ts`
- Modify: `docs/superpowers/plans/2026-03-12-agent-inbox-last-used-platform.md`

- [ ] **Step 1: Run the focused `agent-inbox` test suite**

Run: `pnpm --filter @doctorwu/agent-inbox test`
Expected: PASS

- [ ] **Step 2: Review the final diff**

Run: `git diff --stat` and `git diff -- apps/agent-inbox docs`
Expected: Only the agent-inbox preference behavior, tests, and planning docs changed.

- [ ] **Step 3: Create the final feature commit**

```bash
git add apps/agent-inbox docs/superpowers/plans/2026-03-12-agent-inbox-last-used-platform.md
git commit -m "feat(agent-inbox): remember last used platform"
```

- [ ] **Step 4: Push the branch**

```bash
git push -u origin feat/agent-inbox-last-used-platform
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --fill
```
