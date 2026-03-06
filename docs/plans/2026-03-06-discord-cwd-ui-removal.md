# Discord CWD UI Removal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove Discord user-facing cwd setup and management while keeping backend selection.

**Architecture:** Simplify the setup flow in `packages/discord` so backend selection resolves setup immediately, and delete the cwd slash command surface. Preserve internal cwd state usage so conversation runtime behavior stays stable without exposing extra UI.

**Tech Stack:** TypeScript, discord.js, Vitest, pnpm workspace

---

### Task 1: Simplify thread setup UI

**Files:**
- Modify: `packages/discord/src/commands/thread-setup.ts`
- Test: `packages/discord/src/__tests__/thread-setup.test.ts`

**Step 1: Write the failing test**

Add a test that resolves setup after backend selection and asserts the setup message no longer includes cwd controls or a start button.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/discord test -- thread-setup`
Expected: FAIL because the current setup still renders cwd + start controls.

**Step 3: Write minimal implementation**

Remove cwd menu and start button builders, collect only backend select interactions, and resolve immediately on selection.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/discord test -- thread-setup`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/discord/src/commands/thread-setup.ts packages/discord/src/__tests__/thread-setup.test.ts
git commit -m "refactor(discord): simplify thread setup UI"
```

### Task 2: Remove `/cwd` slash command surface

**Files:**
- Modify: `packages/discord/src/commands/claude-control.ts`
- Test: `packages/discord/src/__tests__/claude-control.test.ts`

**Step 1: Write the failing test**

Add a test asserting `claudeControlCommands` and `claudeControlCommandHandlers` do not include `cwd`.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/discord test -- claude-control`
Expected: FAIL because `/cwd` is still registered.

**Step 3: Write minimal implementation**

Delete `cwdCommand`, remove the `cwd` handler entry, and remove now-unused cwd command helpers/imports.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/discord test -- claude-control`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/discord/src/commands/claude-control.ts packages/discord/src/__tests__/claude-control.test.ts
git commit -m "refactor(discord): remove cwd slash command"
```

### Task 3: Remove cwd follow-up prompts and verify package tests

**Files:**
- Modify: `packages/discord/src/index.ts`
- Modify: `packages/discord/src/__tests__/thread.test.ts`

**Step 1: Write the failing test**

Add a test proving detected cwd no longer triggers a save prompt callback.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/discord test -- thread`
Expected: FAIL because the runtime still wires `offerSaveCwd`.

**Step 3: Write minimal implementation**

Remove the save/ignore cwd prompt path from Discord runtime wiring while leaving internal cwd detection intact.

**Step 4: Run package tests**

Run: `pnpm --filter @agent-im-relay/discord test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/discord/src/index.ts packages/discord/src/__tests__/thread.test.ts
git commit -m "refactor(discord): drop cwd follow-up prompts"
```
