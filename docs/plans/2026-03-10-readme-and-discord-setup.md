# README And Discord Setup Docs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Publish an English, user-facing repository README and a separate Discord bot setup guide that match the current `agent-inbox` product behavior.

**Architecture:** Treat the root README as the public landing page and move repository internals below the user onboarding sections. Put Discord-specific portal steps in a dedicated guide and link to it from the quick-start configuration step.

**Tech Stack:** Markdown, pnpm workspace, GitHub repository docs, official Discord developer docs, existing `@doctorwu/agent-inbox` CLI behavior

---

### Task 1: Document the intended doc structure

**Files:**
- Create: `docs/plans/2026-03-10-readme-and-discord-setup-design.md`
- Create: `docs/plans/2026-03-10-readme-and-discord-setup.md`

**Step 1: Capture the validated structure**

- Record the README ordering, Discord guide scope, and verification expectations in the design doc.

**Step 2: Capture the execution plan**

- Record the exact files to edit and the verification commands in the implementation plan.

### Task 2: Rewrite the root README for end users

**Files:**
- Modify: `README.md`

**Step 1: Replace the Chinese user-facing copy with English copy**

- Keep the product branded as `Agent Inbox`
- Lead with product value, features, and onboarding
- Keep the architecture image and useful badges

**Step 2: Rebuild quick start and support sections**

- Add a three-step quick start
- Add platform and backend support tables
- Link to `docs/discord-setup.md` from configuration guidance

**Step 3: Move technical details lower**

- Keep config example, runtime paths, repo layout, and development commands after the user-facing sections

### Task 3: Add the dedicated Discord setup guide

**Files:**
- Create: `docs/discord-setup.md`

**Step 1: Describe the Discord portal flow**

- Application creation
- Bot creation
- Required privileged intent
- OAuth2 guild invite setup

**Step 2: Translate repo behavior into user instructions**

- Document `token`, `clientId`, and optional `guildIds`
- Recommend permissions needed by the bot's current thread/message workflow
- Explain the difference between global commands and guild-scoped registration

### Task 4: Verify and prepare the branch for PR

**Files:**
- Modify: `README.md`
- Create: `docs/discord-setup.md`

**Step 1: Run verification**

Run:

- `pnpm test`
- `pnpm build`

Expected: PASS

**Step 2: Review git diff for scope control**

- Confirm only the intended doc and plan files changed

**Step 3: Commit and prepare PR**

- Commit the docs updates with a docs-focused message
- Push the feature branch
- Open a PR against `main`
