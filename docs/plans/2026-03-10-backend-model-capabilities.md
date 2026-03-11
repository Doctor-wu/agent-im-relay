# Backend-Owned Model Capabilities Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move model discovery out of relay config and platform hardcoding so every backend reports its own supported models and new sessions start with backend + model selection.

**Architecture:** Extend the backend registry from simple availability checks to capability discovery. Platforms consume a shared capability payload instead of maintaining backend/model lists locally. Conversation state continues to store per-thread selections, with invalid models cleared when backend compatibility changes.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, Discord.js, Feishu card payload builders, local CLI config/cache inspection

---

### Task 1: Add shared backend capability types and helpers

**Files:**
- Modify: `packages/core/src/agent/backend.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/agent/__tests__/backend.test.ts`

**Step 1: Extend backend types**

- Add a backend model descriptor type and `getSupportedModels()` to `AgentBackend`
- Add helpers that return available backend capability objects, not only names

**Step 2: Update exports and tests**

- Export the new types/helpers from `packages/core/src/index.ts`
- Cover availability filtering and capability payload assembly in tests

### Task 2: Remove relay-level model config and move detection into backends

**Files:**
- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/src/agent/backends/claude.ts`
- Modify: `packages/core/src/agent/backends/codex.ts`
- Modify: `packages/core/src/agent/backends/opencode.ts`
- Test: `packages/core/src/__tests__/config.test.ts`
- Test: `packages/core/src/__tests__/backends/codex.test.ts`
- Test: `packages/core/src/__tests__/backends/opencode.test.ts`

**Step 1: Remove relay model config**

- Delete `claudeModel` from `CoreConfig`
- Stop reading and applying `CLAUDE_MODEL` in the relay config proxy

**Step 2: Implement backend-owned model discovery**

- Claude backend: add a local resolver chain behind `getSupportedModels()`
- Codex backend: read model cache/config and expose supported models
- OpenCode backend: use CLI/config discovery and expose supported models

**Step 3: Keep execution behavior explicit**

- Stream calls continue to honor the conversation-selected model
- Claude execution no longer falls back to relay config for model choice

### Task 3: Make session control backend-aware for model state

**Files:**
- Modify: `packages/core/src/session-control/controller.ts`
- Modify: `packages/core/src/platform/conversation.ts`
- Test: `packages/core/src/session-control/__tests__/controller.test.ts`
- Test: `packages/core/src/platform/__tests__/conversation.test.ts`

**Step 1: Clear invalid models on backend changes**

- When switching backend, clear the stored model if it is incompatible with the selected backend
- Preserve effort and cwd behavior

**Step 2: Keep conversation gating simple**

- Setup-required logic stays backend-driven
- Platforms handle the follow-up model choice using shared capability data

### Task 4: Refactor Discord setup and controls to use detected capabilities

**Files:**
- Modify: `packages/discord/src/commands/thread-setup.ts`
- Modify: `packages/discord/src/commands/agent-control.ts`
- Modify: `packages/discord/src/index.ts`
- Test: `packages/discord/src/__tests__/thread-setup.test.ts`
- Test: `packages/discord/src/__tests__/agent-control.test.ts`
- Test: `packages/discord/src/__tests__/conversation.test.ts`

**Step 1: Update new-thread setup**

- Prompt for backend from available capabilities
- Prompt for model from the chosen backend model list when available

**Step 2: Update session controls**

- Replace static model presentation with capability-driven choices or summaries
- Keep `/model` working, but validate or describe choices against the current backend

### Task 5: Refactor Feishu setup cards and controls to use detected capabilities

**Files:**
- Modify: `packages/feishu/src/runtime.ts`
- Modify: `packages/feishu/src/cards.ts`
- Modify: `packages/feishu/src/events.ts`
- Test: `packages/feishu/src/__tests__/backend-gate.test.ts`
- Test: `packages/feishu/src/__tests__/runtime.test.ts`
- Test: `packages/feishu/src/__tests__/events.test.ts`
- Test: `packages/feishu/src/__tests__/cards.test.ts`

**Step 1: Extend the blocked setup flow**

- After backend selection, present model selection when the backend reports models
- Resume the queued run only after the required selections are applied

**Step 2: Update control panel payloads**

- Render backend and model actions dynamically
- Remove hardcoded model buttons from Feishu cards

### Task 6: Verify, commit, and open the PR

**Files:**
- Modify: the implementation files above
- Create: `docs/plans/2026-03-10-backend-model-capabilities-design.md`
- Create: `docs/plans/2026-03-10-backend-model-capabilities.md`

**Step 1: Run verification**

Run:

- `pnpm test`

Expected: PASS

**Step 2: Review git scope**

- Confirm changes are limited to backend capability, session-control, and platform setup files

**Step 3: Commit and publish**

- Commit the design/plan docs
- Commit the implementation
- Push `feat/backend-model-capabilities`
- Open a PR against `main`
