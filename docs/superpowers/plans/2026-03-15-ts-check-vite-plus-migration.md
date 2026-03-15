# TS Check and Vite Plus Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workspace TypeScript check, remove local `.js` import suffixes, migrate all TypeScript builds to `vite-plus`, and drop SEA packaging while preserving npm distribution.

**Architecture:** First align TypeScript project references and imports so `tsc --noEmit` becomes a trustworthy workspace gate. Then replace `tsdown` with `vite-plus` at the workspace and package level, remove SEA artifacts, and verify that package build and prepack flows still produce the expected npm outputs.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, vite-plus, Node.js ESM

---

## Chunk 1: Typecheck Baseline and Failing Coverage

### Task 1: Add a workspace typecheck entrypoint

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `packages/*/tsconfig.json`
- Modify: `apps/agent-inbox/tsconfig.json`

- [ ] **Step 1: Add a root typecheck script**

Add a root script that runs workspace TypeScript checking without emit.

- [ ] **Step 2: Run the typecheck command to capture the failing baseline**

Run: `pnpm exec tsc --noEmit`
Expected: FAIL with current workspace TypeScript errors.

- [ ] **Step 3: Adjust project reference and compiler settings**

Update root and package `tsconfig` files so workspace references resolve correctly for no-emit typechecking.

- [ ] **Step 4: Re-run the typecheck command**

Run: `pnpm exec tsc --noEmit`
Expected: still FAIL, but only on real source/type issues rather than broken config wiring.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json packages/*/tsconfig.json apps/agent-inbox/tsconfig.json
git commit -m "chore: add workspace typecheck baseline"
```

### Task 2: Remove `.js` suffixes and fix resulting TS errors

**Files:**
- Modify: `packages/**/*.ts`
- Modify: `apps/agent-inbox/src/**/*.ts`
- Modify: `apps/agent-inbox/src/__tests__/*.ts`

- [ ] **Step 1: Add or update tests that lock the desired import and build contract where needed**

Prefer existing packaging and config tests when they already cover the import and output contract. Add targeted coverage only if current tests do not expose the affected behavior.

- [ ] **Step 2: Run the targeted tests before changes**

Run: `pnpm --filter @doctorwu/agent-inbox test`
Expected: PASS on current baseline so any new failures are introduced by the migration.

- [ ] **Step 3: Remove local `.js` suffixes from TypeScript imports**

Change local source and test imports from `./x.js` to `./x` and from `../x.js` to `../x`.

- [ ] **Step 4: Fix all TypeScript errors exposed by the import cleanup**

Write minimal source and config changes until the workspace typecheck passes.

- [ ] **Step 5: Verify the new gate**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Verify related tests**

Run: `pnpm -r test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages apps package.json tsconfig.json
git commit -m "refactor: remove ts source import extensions"
```

## Chunk 2: Build Migration to Vite Plus

### Task 3: Replace `tsdown` with `vite-plus`

**Files:**
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `packages/*/package.json`
- Modify: `apps/agent-inbox/package.json`
- Create or Modify: `vite.config.ts`
- Delete: `packages/*/tsdown.config.ts`
- Delete: `apps/agent-inbox/tsdown.config.ts`

- [ ] **Step 1: Add a failing packaging or build expectation if coverage is missing**

Prefer extending existing packaging tests over introducing new suites. The test should detect broken output paths or missing CLI or bin artifacts after the bundler swap.

- [ ] **Step 2: Run the specific packaging or build tests to verify the baseline**

Run: `pnpm --filter @doctorwu/agent-inbox test`
Expected: PASS.

- [ ] **Step 3: Replace workspace build dependencies and scripts**

Install `vite-plus`, remove `tsdown`, add required workspace overrides, and move package and app build scripts to `vite-plus`.

- [ ] **Step 4: Replace package build config**

Create the minimal `vite-plus` config needed for the workspace and each build target while preserving current output contracts.

- [ ] **Step 5: Delete `tsdown` config files**

Remove now-unused `tsdown.config.ts` files.

- [ ] **Step 6: Verify workspace builds**

Run: `pnpm -r build`
Expected: PASS with `vite-plus`.

- [ ] **Step 7: Verify tests**

Run: `pnpm -r test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml vite.config.ts packages apps
git commit -m "build: migrate workspace to vite-plus"
```

### Task 4: Remove SEA packaging and align docs

**Files:**
- Delete: `apps/agent-inbox/scripts/build-executable.mjs`
- Delete: `apps/agent-inbox/scripts/sea-build.mjs`
- Modify: `apps/agent-inbox/package.json`
- Modify: `apps/agent-inbox/README.md`
- Modify: `README.md`
- Modify: direct docs that still present SEA as an active distribution path

- [ ] **Step 1: Add or reuse a failing assertion for the npm distribution contract**

Use the existing packaging tests to keep npm distribution behavior under test after SEA removal.

- [ ] **Step 2: Remove SEA scripts, dependencies, and references**

Delete scripts and dependencies that exist only for Node SEA builds.

- [ ] **Step 3: Update direct documentation**

Rewrite current user-facing docs so npm package distribution is the supported path and SEA is no longer referenced as active workflow.

- [ ] **Step 4: Verify prepack and packaging**

Run: `pnpm --filter @doctorwu/agent-inbox prepack`
Expected: PASS.

- [ ] **Step 5: Verify full workspace again**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

Run: `pnpm -r test`
Expected: PASS.

Run: `pnpm -r build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add README.md apps/agent-inbox/package.json apps/agent-inbox/README.md apps/agent-inbox/scripts packages docs
git commit -m "chore: remove sea packaging flow"
```
