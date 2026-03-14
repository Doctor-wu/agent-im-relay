# Preset Backend Model Setup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure preset backends still trigger model selection, and that model selection timeout falls back to a compatible model before resuming the run on Discord and Feishu.

**Architecture:** Extend the setup/runtime gates so "backend already known" no longer implies "setup complete". Discord keeps using the existing setup UI but can jump straight into model selection when the backend is preset, while Feishu reuses its runtime model gate and restores the timeout fallback logic for blocked runs. Both paths preserve the existing backend timeout behavior and only auto-pick models when the backend actually requires one.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Discord.js, Feishu runtime helpers

---

## Chunk 1: Discord preset-backend setup path

### Task 1: Cover the Discord regression first

**Files:**
- Modify: `packages/discord/src/__tests__/index.test.ts`
- Modify: `packages/discord/src/__tests__/thread-setup.test.ts`

- [ ] **Step 1: Write the failing regression test for preset backend -> model setup**

Add a Discord message-create test that persists `<set-backend>` to the new thread, skips backend selection UI, and still calls setup in a way that can render model selection for the preset backend.

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `pnpm vitest run packages/discord/src/__tests__/index.test.ts packages/discord/src/__tests__/thread-setup.test.ts`
Expected: FAIL showing the preset-backend path never opens model selection / times out incorrectly.

- [ ] **Step 3: Write the minimal Discord implementation**

Modify `packages/discord/src/commands/thread-setup.ts` and `packages/discord/src/index.ts` so:
- `promptThreadSetup()` accepts an optional preset backend
- preset backends skip the backend card and open the model card directly when needed
- model timeout falls back to a compatible existing model or the backend's first model
- the caller decides setup is needed when backend is missing or backend is present but model is still required

- [ ] **Step 4: Run the targeted Discord tests to verify they pass**

Run: `pnpm vitest run packages/discord/src/__tests__/index.test.ts packages/discord/src/__tests__/thread-setup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the Discord slice**

```bash
git add packages/discord/src/index.ts packages/discord/src/commands/thread-setup.ts packages/discord/src/__tests__/index.test.ts packages/discord/src/__tests__/thread-setup.test.ts
git commit -m "fix(discord): require model setup for preset backends"
```

## Chunk 2: Feishu parity and runtime fallback

### Task 2: Restore Feishu model timeout fallback for preset backends

**Files:**
- Modify: `packages/feishu/src/runtime.ts`
- Modify: `packages/feishu/src/__tests__/runtime.test.ts`

- [ ] **Step 1: Write the failing Feishu regression tests**

Add tests for:
- a preset backend with models still blocking on model selection
- model selection timeout auto-picking a compatible model and resuming
- manual model selection canceling the timeout path

- [ ] **Step 2: Run the targeted Feishu tests to verify they fail**

Run: `pnpm vitest run packages/feishu/src/__tests__/runtime.test.ts`
Expected: FAIL because timeout fallback is currently absent and preset-backend blocked runs do not auto-resume.

- [ ] **Step 3: Write the minimal Feishu implementation**

Restore the model timeout helper in `packages/feishu/src/runtime.ts` and hook it into the blocked model-selection path so pending runs resume after timeout using the last compatible model or first backend model.

- [ ] **Step 4: Run the targeted Feishu tests to verify they pass**

Run: `pnpm vitest run packages/feishu/src/__tests__/runtime.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the Feishu slice**

```bash
git add packages/feishu/src/runtime.ts packages/feishu/src/__tests__/runtime.test.ts
git commit -m "fix(feishu): restore model fallback for preset backends"
```

## Chunk 3: Verification and integration

### Task 3: Verify the cross-platform setup flow and prepare the PR

**Files:**
- Modify: `packages/discord/src/commands/thread-setup.ts`
- Modify: `packages/discord/src/index.ts`
- Modify: `packages/feishu/src/runtime.ts`
- Modify: tests touched above

- [ ] **Step 1: Run the focused package tests**

Run: `pnpm vitest run packages/discord/src/__tests__/index.test.ts packages/discord/src/__tests__/thread-setup.test.ts packages/feishu/src/__tests__/runtime.test.ts`
Expected: PASS

- [ ] **Step 2: Run the broader related suite**

Run: `pnpm vitest run packages/discord/src/__tests__/conversation.test.ts packages/feishu/src/__tests__/backend-gate.test.ts`
Expected: PASS

- [ ] **Step 3: Review the final diff**

Run: `git diff --stat` and `git diff -- packages/discord packages/feishu`
Expected: Only the targeted setup/runtime and tests changed.

- [ ] **Step 4: Create the final commit**

```bash
git add packages/discord/src packages/feishu/src docs/superpowers/plans/2026-03-12-preset-backend-model-setup.md
git commit -m "fix: require model selection for preset backends"
```

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin fix/preset-backend-model-setup
gh pr create --fill
```
