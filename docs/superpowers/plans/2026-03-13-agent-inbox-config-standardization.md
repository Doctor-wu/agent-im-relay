# Agent Inbox Config Standardization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all package configuration loading to `~/.agent-inbox/config.jsonl`, add Slack to the shared schema, and remove `.env` / `dotenv` package bootstrap paths without breaking launcher or standalone runtime entrypoints.

**Architecture:** Consolidate config schema, normalization, and file I/O in `packages/core`, then refit `apps/agent-inbox` and the runtime packages to consume that shared layer. Preserve runtime behavior by keeping typed config objects stable and only changing where they are sourced from.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, tsdown

---

## Chunk 1: Shared Config Layer In Core

### Task 1: Add failing tests for shared config records and Slack support

**Files:**
- Modify: `packages/core/src/__tests__/config.test.ts`
- Test: `packages/core/src/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing tests**

Add focused tests that expect:
- JSONL parsing to accept a Slack `im` record
- shared config loading to expose Slack alongside Discord and Feishu
- typed readers to resolve runtime defaults and relay paths from a temp HOME directory

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core vitest run src/__tests__/config.test.ts`
Expected: FAIL because Slack shared config support does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Update `packages/core/src/config.ts` to:
- own the JSONL schema currently defined in `apps/agent-inbox`
- add Slack record types and normalization
- read/write `~/.agent-inbox/config.jsonl`
- export shared typed readers for core, Discord, Feishu, and Slack

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core vitest run src/__tests__/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config.ts packages/core/src/__tests__/config.test.ts
git commit -m "feat(core): centralize relay config schema"
```

### Task 2: Export the shared config APIs from core

**Files:**
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/config.test.ts`

- [ ] **Step 1: Write or extend the failing test**

Add assertions that the shared config helpers are exported from the public `@agent-im-relay/core` surface.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core vitest run src/__tests__/config.test.ts`
Expected: FAIL because the exports are missing.

- [ ] **Step 3: Write minimal implementation**

Export the new shared config types and helpers from `packages/core/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core vitest run src/__tests__/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/__tests__/config.test.ts
git commit -m "feat(core): export shared relay config helpers"
```

## Chunk 2: Migrate Runtime Packages Off Dotenv

### Task 3: Convert Discord config loading to the shared config source

**Files:**
- Modify: `packages/discord/src/config.ts`
- Modify: `packages/discord/src/__tests__/config.test.ts`
- Modify: `packages/discord/vitest.setup.ts`

- [ ] **Step 1: Write the failing test**

Add a test that seeds a temp `HOME/.agent-inbox/config.jsonl`, imports `readDiscordConfig()`, and expects the returned config to match the file contents without relying on `process.env`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/discord vitest run src/__tests__/config.test.ts`
Expected: FAIL because Discord still reads env values.

- [ ] **Step 3: Write minimal implementation**

Update Discord config loading to call the shared core reader and remove `dotenv`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/discord vitest run src/__tests__/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/discord/src/config.ts packages/discord/src/__tests__/config.test.ts packages/discord/vitest.setup.ts
git commit -m "feat(discord): load config from relay config file"
```

### Task 4: Convert Feishu config loading to the shared config source

**Files:**
- Modify: `packages/feishu/src/config.ts`
- Modify: `packages/feishu/src/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing test**

Add a temp-HOME test that expects `readFeishuConfig()` to load from `~/.agent-inbox/config.jsonl`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu vitest run src/__tests__/config.test.ts`
Expected: FAIL because Feishu still reads env values.

- [ ] **Step 3: Write minimal implementation**

Update Feishu config loading to use the shared core reader and remove `dotenv`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu vitest run src/__tests__/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/feishu/src/config.ts packages/feishu/src/__tests__/config.test.ts
git commit -m "feat(feishu): load config from relay config file"
```

### Task 5: Convert Slack config loading to the shared config source

**Files:**
- Modify: `packages/slack/src/config.ts`
- Modify: `packages/slack/src/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing test**

Add a temp-HOME test that expects `readSlackConfig()` to load from `~/.agent-inbox/config.jsonl`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/slack vitest run src/__tests__/config.test.ts`
Expected: FAIL because Slack still reads env values.

- [ ] **Step 3: Write minimal implementation**

Update Slack config loading to use the shared core reader and remove `dotenv`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/slack vitest run src/__tests__/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/slack/src/config.ts packages/slack/src/__tests__/config.test.ts
git commit -m "feat(slack): load config from relay config file"
```

## Chunk 3: Reuse Shared Schema In Agent Inbox

### Task 6: Switch app config logic to reuse core schema and add Slack support

**Files:**
- Modify: `apps/agent-inbox/src/config.ts`
- Modify: `apps/agent-inbox/src/setup.ts`
- Modify: `apps/agent-inbox/src/runtime.ts`
- Modify: `apps/agent-inbox/src/__tests__/config.test.ts`
- Modify: `apps/agent-inbox/src/__tests__/setup.test.ts`
- Modify: `apps/agent-inbox/src/__tests__/runtime.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that expect:
- Slack records to round-trip through app load/save helpers
- app setup to persist Slack config
- runtime startup to recognize Slack as an available platform

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @doctorwu/agent-inbox vitest run src/__tests__/config.test.ts src/__tests__/setup.test.ts src/__tests__/runtime.test.ts`
Expected: FAIL because Slack is not part of the shared app flow yet.

- [ ] **Step 3: Write minimal implementation**

Refactor app config code to consume core shared types and helpers, then extend setup/runtime for Slack.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @doctorwu/agent-inbox vitest run src/__tests__/config.test.ts src/__tests__/setup.test.ts src/__tests__/runtime.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/agent-inbox/src/config.ts apps/agent-inbox/src/setup.ts apps/agent-inbox/src/runtime.ts apps/agent-inbox/src/__tests__/config.test.ts apps/agent-inbox/src/__tests__/setup.test.ts apps/agent-inbox/src/__tests__/runtime.test.ts
git commit -m "feat(agent-inbox): unify relay config schema"
```

## Chunk 4: Remove Dotenv And Update Docs

### Task 7: Remove obsolete dependencies and update user-facing docs

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/discord/package.json`
- Modify: `packages/feishu/package.json`
- Modify: `packages/slack/package.json`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `.env.example` or delete if obsolete
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write the failing test or assertion**

Use a repository scan as the failing check.

- [ ] **Step 2: Run the failing check**

Run: `rg -n "dotenv|\\.env\\b" packages apps README.md AGENTS.md CLAUDE.md`
Expected: matches still exist.

- [ ] **Step 3: Write minimal implementation**

Remove `dotenv` dependencies and update docs to describe `~/.agent-inbox/config.jsonl` as the only config source.

- [ ] **Step 4: Run the check to verify it passes**

Run: `rg -n "dotenv|\\.env\\b" packages apps README.md AGENTS.md CLAUDE.md`
Expected: no package/runtime `.env` references remain.

- [ ] **Step 5: Commit**

```bash
git add packages/core/package.json packages/discord/package.json packages/feishu/package.json packages/slack/package.json README.md AGENTS.md CLAUDE.md .env.example pnpm-lock.yaml
git commit -m "chore: remove dotenv config paths"
```

## Chunk 5: Final Verification

### Task 8: Run focused verification and summarize residual risks

**Files:**
- Modify: `docs/superpowers/plans/2026-03-13-agent-inbox-config-standardization.md`

- [ ] **Step 1: Run focused tests**

Run:
- `pnpm --filter @agent-im-relay/core test`
- `pnpm --filter @agent-im-relay/discord vitest run src/__tests__/config.test.ts`
- `pnpm --filter @agent-im-relay/feishu test`
- `pnpm --filter @agent-im-relay/slack test`
- `pnpm --filter @doctorwu/agent-inbox test`

Expected:
- all focused migration tests pass
- known unrelated Discord baseline failures remain unchanged unless touched by this work

- [ ] **Step 2: Run final residue scan**

Run: `rg -n "dotenv|\\.env\\b|process\\.env" packages apps --glob '!**/__tests__/**'`
Expected: only intentional process-env bridge code remains; no dotenv or `.env` reads remain.

- [ ] **Step 3: Update plan notes**

Record the actual verification commands and any residual known baseline failures.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-03-13-agent-inbox-config-standardization.md
git commit -m "docs: record config migration verification"
```
