# Agent IM Relay Architecture Diagram Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Produce a colleague-facing architecture diagram that explains both the current Discord implementation and the platform-agnostic expansion path of `agent-im-relay`.

**Architecture:** Use a dual-layer SVG diagram. The top half shows static structure across `@agent-im-relay/core`, `@agent-im-relay/discord`, backends, and artifact/state storage. The bottom half shows the numbered runtime flow for messages, attachments, streaming output, and returned files.

**Tech Stack:** SVG, TypeScript source analysis, pnpm workspace monorepo

---

### Task 1: Capture the validated diagram scope

**Files:**
- Create: `agent-im-relay/docs/plans/2026-03-07-agent-im-relay-architecture-diagram-plan.md`
- Create: `agent-im-relay/docs/assets/agent-im-relay-architecture.svg`

**Step 1: Confirm scope from source**

Read the current README plus the key runtime files in `packages/core/src/` and `packages/discord/src/`.

**Step 2: Lock the diagram framing**

Show both:
- current implemented path: Discord -> Discord package -> core runtime -> Claude/Codex
- future extension path: additional IM adapters reusing the same core capabilities

**Step 3: Define the essential flows**

Include these numbered paths:
- user message and slash command entry
- attachment download into `data/artifacts/<conversationId>/incoming`
- prompt assembly and backend session startup
- event streaming back into Discord message edits
- artifact manifest parsing and upload from `outgoing`

### Task 2: Build the SVG asset

**Files:**
- Create: `agent-im-relay/docs/assets/agent-im-relay-architecture.svg`

**Step 1: Draw the main containers**

Create panels for user/Discord, `@agent-im-relay/discord`, `@agent-im-relay/core`, agent backends, and persisted storage.

**Step 2: Add implementation detail labels**

Name the concrete modules that matter to teammates:
- `runMentionConversation`
- `streamAgentToDiscord`
- `prepareAttachmentPrompt`
- `runConversationSession`
- backend registry
- artifact store
- conversation state maps

**Step 3: Add expansion affordances**

Show Slack/Telegram/Feishu as future adapters connected through the same core boundary.

### Task 3: Verify handoff quality

**Files:**
- Create: `agent-im-relay/docs/assets/agent-im-relay-architecture.svg`

**Step 1: Verify the file exists**

Run: `test -f agent-im-relay/docs/assets/agent-im-relay-architecture.svg`
Expected: exit code 0

**Step 2: Verify the SVG root exists**

Run: `rg -n \"<svg|</svg>\" agent-im-relay/docs/assets/agent-im-relay-architecture.svg`
Expected: matching opening and closing tags

**Step 3: Verify the file is shareable**

Run: `wc -c agent-im-relay/docs/assets/agent-im-relay-architecture.svg`
Expected: non-zero byte size
