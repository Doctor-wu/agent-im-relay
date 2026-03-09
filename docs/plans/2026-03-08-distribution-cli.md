# Distribution CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a single user-facing `agent-im-relay` program with home-directory JSONL config, IM-based startup selection, and single-process Feishu runtime prepared for distribution.

**Architecture:** Keep the existing `core`, `discord`, and `feishu` packages for runtime logic, and add a new CLI-facing package that owns config storage, setup flow, and startup dispatch. Move runtime defaults to `~/.agent-im-relay/` and remove Feishu split-deployment product paths.

**Tech Stack:** TypeScript, Node.js, pnpm workspace, tsdown, vitest

---

### Task 1: Add the user-facing CLI package

**Files:**
- Create: `apps/agent-im-relay/package.json`
- Create: `apps/agent-im-relay/tsconfig.json`
- Create: `apps/agent-im-relay/tsdown.config.ts`
- Create: `apps/agent-im-relay/src/index.ts`
- Create: `apps/agent-im-relay/src/cli.ts`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`

**Step 1: Write the failing test**

Create a CLI-focused test file that expects the app package to expose a single startup surface and resolve the home config directory contract.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/app test`
Expected: FAIL because the package and entrypoints do not exist yet.

**Step 3: Write minimal implementation**

Create the app package with a single entrypoint and tsdown config suitable for bundling the CLI.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/app test`
Expected: PASS

### Task 2: Introduce JSONL config and home-directory runtime paths

**Files:**
- Create: `apps/agent-im-relay/src/config.ts`
- Create: `apps/agent-im-relay/src/config-paths.ts`
- Create: `apps/agent-im-relay/src/__tests__/config.test.ts`
- Modify: `packages/core/src/config.ts`
- Modify: `packages/discord/src/config.ts`
- Modify: `packages/feishu/src/config.ts`

**Step 1: Write the failing test**

Add tests for:
- parsing `config.jsonl`
- ignoring invalid IM entries while surfacing useful errors
- deriving `~/.agent-im-relay/state` and `~/.agent-im-relay/artifacts`

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/app test -- config`
Expected: FAIL because the loader and path resolver do not exist.

**Step 3: Write minimal implementation**

Implement the config loader/writer and refactor runtime config defaults so state and artifact storage come from the home directory contract instead of `process.cwd()` and repo-root `.env`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/app test -- config`
Expected: PASS

### Task 3: Add interactive setup and IM selection

**Files:**
- Create: `apps/agent-im-relay/src/setup.ts`
- Create: `apps/agent-im-relay/src/prompts.ts`
- Create: `apps/agent-im-relay/src/__tests__/setup.test.ts`
- Modify: `apps/agent-im-relay/src/cli.ts`

**Step 1: Write the failing test**

Add tests covering:
- first run with no config
- one configured IM
- multiple configured IMs

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/app test -- setup`
Expected: FAIL because the setup flow does not exist.

**Step 3: Write minimal implementation**

Implement a prompt-driven onboarding flow and IM selection that only shows configured, valid IM records.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/app test -- setup`
Expected: PASS

### Task 4: Wire runtime dispatch to Discord and Feishu

**Files:**
- Create: `apps/agent-im-relay/src/runtime.ts`
- Create: `apps/agent-im-relay/src/__tests__/runtime.test.ts`
- Modify: `packages/discord/src/index.ts`
- Modify: `packages/feishu/src/index.ts`

**Step 1: Write the failing test**

Add tests asserting the app package dispatches to the correct runtime for configured IM selections.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/app test -- runtime`
Expected: FAIL because no dispatch layer exists.

**Step 3: Write minimal implementation**

Expose runtime start functions from Discord and Feishu, then wire the app package to call them.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/app test -- runtime`
Expected: PASS

### Task 5: Remove Feishu split deployment and simplify configuration

**Files:**
- Modify: `packages/feishu/src/index.ts`
- Delete or stop using: `packages/feishu/src/bin/client.ts`
- Modify: `packages/feishu/src/config.ts`
- Modify: `packages/feishu/src/__tests__/config.test.ts`
- Modify: `README.md`
- Modify: `.env.example`

**Step 1: Write the failing test**

Add or update tests so Feishu config no longer expects split-deployment fields and only validates single-process startup inputs.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test`
Expected: FAIL because the old config surface still requires split mode fields.

**Step 3: Write minimal implementation**

Remove the split-deployment configuration and keep only the single-process Feishu runtime path.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test`
Expected: PASS

### Task 6: Update packaging and docs for distribution

**Files:**
- Modify: `apps/agent-im-relay/package.json`
- Modify: `apps/agent-im-relay/tsdown.config.ts`
- Modify: `packages/discord/package.json`
- Modify: `packages/feishu/package.json`
- Modify: `README.md`

**Step 1: Write the failing test**

Add or update a packaging-oriented test or smoke assertion that the app build emits the intended entry artifact.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/app build`
Expected: FAIL or missing expected output before packaging is wired correctly.

**Step 3: Write minimal implementation**

Promote the app package as the distribution target, keep package entrypoints explicit, and document the new runtime contract around `~/.agent-im-relay/`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/app build`
Expected: build succeeds and emits the intended runnable artifact.

### Task 7: Verify end-to-end behavior

**Files:**
- Modify as needed based on verification findings

**Step 1: Run targeted tests**

Run:
- `pnpm --filter @agent-im-relay/app test`
- `pnpm --filter @agent-im-relay/core test`
- `pnpm --filter @agent-im-relay/discord test`
- `pnpm --filter @agent-im-relay/feishu test`

Expected: PASS

**Step 2: Run build verification**

Run:
- `pnpm build`

Expected: PASS with the app package producing the primary runnable artifact.

**Step 3: Manual smoke check**

Run the built app entry once against a temporary home directory and confirm it creates the expected `config.jsonl`, `state/`, `artifacts/`, and IM selection flow.
