# Agent Inbox Rename Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename the user-facing distribution app from `agent-im-relay` to `Agent Inbox`, including the CLI command, app package path, executable artifact, and default home directory.

**Architecture:** Keep the internal workspace structure intact while renaming the public surface area. Update the app workspace from `apps/agent-im-relay` to `apps/agent-inbox`, switch launcher-facing strings and generated artifact names to `agent-inbox`, and move the default runtime home from `~/.agent-im-relay` to `~/.agent-inbox`.

**Tech Stack:** pnpm workspace, TypeScript, tsdown, Vitest, Node SEA packaging

---

### Task 1: Rename the app workspace and public package metadata

**Files:**
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `tsconfig.json`
- Move: `apps/agent-im-relay` -> `apps/agent-inbox`
- Modify: `apps/agent-inbox/package.json`
- Modify: `apps/agent-inbox/scripts/build-executable.mjs`

**Step 1: Update workspace references**

Change root scripts and project references to point at `apps/agent-inbox`.

**Step 2: Rename the app directory**

Move the user-facing app workspace to `apps/agent-inbox`.

**Step 3: Update package metadata**

Change the package name, `bin` command, and generated executable names from `agent-im-relay` to `agent-inbox`.

**Step 4: Verify workspace resolution**

Run: `pnpm --filter @agent-inbox/app test -- --run src/__tests__/config.test.ts`
Expected: PASS

### Task 2: Rename launcher-facing runtime paths and strings

**Files:**
- Modify: `packages/core/src/paths.ts`
- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/agent-inbox/src/index.ts`
- Modify: `apps/agent-inbox/src/__tests__/config.test.ts`
- Modify: `apps/agent-inbox/src/__tests__/setup.test.ts`
- Modify: `packages/feishu/src/__tests__/server.test.ts`

**Step 1: Update default home directory**

Change default paths from `~/.agent-im-relay` to `~/.agent-inbox`.

**Step 2: Update launcher-visible strings**

Rename startup/error labels and temp directory names used by tests to match `agent-inbox`.

**Step 3: Verify focused tests**

Run: `pnpm --filter @agent-inbox/app test -- --run src/__tests__/config.test.ts src/__tests__/setup.test.ts`
Expected: PASS

### Task 3: Refresh docs and run full verification

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `pnpm-lock.yaml`

**Step 1: Update public documentation**

Rename the project display name, CLI references, artifact paths, and config home directory.

**Step 2: Refresh lockfile metadata**

Run workspace install metadata updates if needed so the lockfile reflects the renamed app workspace.

**Step 3: Run verification**

Run: `pnpm test`
Expected: PASS

Run: `pnpm build`
Expected: PASS and create `apps/agent-inbox/dist/agent-inbox`
