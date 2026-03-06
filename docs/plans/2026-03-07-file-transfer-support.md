# File Transfer Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add bidirectional file support so Discord users can send attachments into agent sessions and `/code` threads can return generated files back into Discord.

**Architecture:** Introduce a platform-agnostic artifact store in `@agent-im-relay/core` for per-conversation file metadata, directory allocation, artifact manifest parsing, and retention. Update the Discord adapter to download incoming attachments before each run, inject attachment context into prompts, and upload agent-declared outgoing artifacts after streaming completes.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Discord.js, Vitest, workspace packages `@agent-im-relay/core` and `@agent-im-relay/discord`, `@pnpm`, `@vitest`

---

### Task 1: Add the core artifact store primitives

**Files:**
- Create: `agent-im-relay/packages/core/src/artifacts/store.ts`
- Create: `agent-im-relay/packages/core/src/artifacts/protocol.ts`
- Create: `agent-im-relay/packages/core/src/artifacts/types.ts`
- Create: `agent-im-relay/packages/core/src/__tests__/artifacts.test.ts`
- Modify: `agent-im-relay/packages/core/src/config.ts`
- Modify: `agent-im-relay/packages/core/src/index.ts`

**Step 1: Write the failing test**

- Add tests for per-conversation directory allocation under `data/artifacts/<conversationId>/`
- Add tests for writing and reloading lightweight `meta.json`
- Add tests for parsing the last valid `artifacts` fenced block
- Add tests for rejecting paths that escape the allowed root

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/__tests__/artifacts.test.ts`
Expected: FAIL because the artifact modules do not exist yet

**Step 3: Write minimal implementation**

- Add artifact config defaults such as base directory and retention days
- Implement `ensureConversationArtifactPaths(conversationId)`
- Implement metadata read/write helpers
- Implement `parseArtifactManifest(text)` and safe-path validation helpers
- Export the new artifact APIs from `packages/core/src/index.ts`

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/__tests__/artifacts.test.ts`
Expected: PASS

### Task 2: Persist artifact metadata and tolerate missing files

**Files:**
- Modify: `agent-im-relay/packages/core/src/persist.ts`
- Modify: `agent-im-relay/packages/core/src/state.ts`
- Modify: `agent-im-relay/packages/core/src/__tests__/orchestrator.test.ts`
- Modify: `agent-im-relay/packages/core/src/__tests__/artifacts.test.ts`

**Step 1: Write the failing test**

- Add a test proving artifact metadata is persisted separately from session state
- Add a test proving reload tolerates missing artifact directories or files

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/__tests__/artifacts.test.ts src/__tests__/orchestrator.test.ts`
Expected: FAIL because artifact metadata is not wired into state lifecycle yet

**Step 3: Write minimal implementation**

- Decide whether artifact metadata lives entirely in `meta.json` or keeps a lightweight in-memory index in `state.ts`
- Wire startup helpers so existing sessions can read metadata without crashing on missing files
- Keep `sessions.json` small; do not serialize file payloads into persisted state

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/__tests__/artifacts.test.ts src/__tests__/orchestrator.test.ts`
Expected: PASS

### Task 3: Download Discord attachments into conversation storage

**Files:**
- Create: `agent-im-relay/packages/discord/src/files.ts`
- Create: `agent-im-relay/packages/discord/src/__tests__/files.test.ts`
- Modify: `agent-im-relay/packages/discord/src/conversation.ts`
- Modify: `agent-im-relay/packages/discord/src/index.ts`
- Modify: `agent-im-relay/packages/discord/src/commands/code.ts`
- Modify: `agent-im-relay/packages/discord/src/commands/ask.ts`

**Step 1: Write the failing test**

- Add tests that turn Discord message attachments into downloaded local files plus metadata
- Add tests that `/code` and active-thread messages pass attachments through the conversation runner
- Add tests that `/ask` also downloads attachments and includes them in its prompt context

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/files.test.ts src/__tests__/code.test.ts src/__tests__/conversation.test.ts`
Expected: FAIL because attachment download support does not exist yet

**Step 3: Write minimal implementation**

- Implement a downloader that saves attachments into the core conversation `incoming/` directory
- Infer file kind from MIME type / extension and capture a lightweight preview for image, Markdown, and PDF when cheap
- Thread attachment metadata through `runMentionConversation()`
- Extend `/ask` to collect attachments from the interaction and build the same prompt context

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/files.test.ts src/__tests__/code.test.ts src/__tests__/conversation.test.ts`
Expected: PASS

### Task 4: Inject attachment context into agent prompts

**Files:**
- Modify: `agent-im-relay/packages/core/src/agent/runtime.ts`
- Modify: `agent-im-relay/packages/core/src/agent/session.ts`
- Modify: `agent-im-relay/packages/discord/src/conversation.ts`
- Modify: `agent-im-relay/packages/discord/src/commands/ask.ts`
- Modify: `agent-im-relay/packages/discord/src/__tests__/conversation.test.ts`
- Modify: `agent-im-relay/packages/core/src/agent/__tests__/runtime.test.ts`

**Step 1: Write the failing test**

- Add a test showing prompts receive an attachment context block with local paths and preview lines
- Add a test showing `/ask` does not advertise outgoing artifact uploads
- Add a test showing `/code` instructions include the `artifacts` block contract

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/agent/__tests__/runtime.test.ts && pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/conversation.test.ts`
Expected: FAIL because prompt augmentation is not implemented yet

**Step 3: Write minimal implementation**

- Add a small prompt builder that prepends attachment summaries when attachments exist
- Keep `/ask` prompt text limited to inbound attachment reading
- Add code-mode instructions that define the final `artifacts` fenced JSON block contract

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/agent/__tests__/runtime.test.ts && pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/conversation.test.ts`
Expected: PASS

### Task 5: Parse outgoing artifacts and upload them to Discord

**Files:**
- Create: `agent-im-relay/packages/discord/src/artifacts.ts`
- Create: `agent-im-relay/packages/discord/src/__tests__/artifacts.test.ts`
- Modify: `agent-im-relay/packages/discord/src/stream.ts`
- Modify: `agent-im-relay/packages/discord/src/conversation.ts`
- Modify: `agent-im-relay/packages/core/src/artifacts/protocol.ts`
- Modify: `agent-im-relay/packages/core/src/__tests__/artifacts.test.ts`

**Step 1: Write the failing test**

- Add a test where final agent output includes a valid `artifacts` block and Discord uploads the files
- Add a test where invalid paths are ignored with a warning
- Add a test where missing files or upload failures produce user-facing fallback text

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/artifacts.test.ts src/__tests__/stream.test.ts`
Expected: FAIL because outgoing artifact parsing and upload are not connected yet

**Step 3: Write minimal implementation**

- Parse the final `artifacts` block after the stream completes
- Remove the machine-readable block from the rendered user-facing message
- Validate file paths and sizes before upload
- Upload approved files into the thread and record outgoing metadata

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/artifacts.test.ts src/__tests__/stream.test.ts`
Expected: PASS

### Task 6: Add cleanup policy, limits, and documentation

**Files:**
- Modify: `agent-im-relay/packages/core/src/config.ts`
- Modify: `agent-im-relay/packages/core/src/artifacts/store.ts`
- Modify: `agent-im-relay/packages/discord/src/config.ts`
- Modify: `agent-im-relay/README.md`
- Modify: `agent-im-relay/packages/core/src/__tests__/artifacts.test.ts`
- Modify: `agent-im-relay/packages/discord/src/__tests__/artifacts.test.ts`

**Step 1: Write the failing test**

- Add tests for lazy retention cleanup and upload/download size limits
- Add docs assertions only if the repo already validates docs content; otherwise skip automated doc checks

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/__tests__/artifacts.test.ts && pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/artifacts.test.ts`
Expected: FAIL because cleanup and limits are not enforced yet

**Step 3: Write minimal implementation**

- Add env-configurable retention days and max attachment size
- Run cleanup opportunistically before reads/writes or on startup
- Document inbound/outbound file behavior, `/ask` limitation, and artifact protocol in `README.md`

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/core test -- --run src/__tests__/artifacts.test.ts && pnpm --filter @agent-im-relay/discord test -- --run src/__tests__/artifacts.test.ts`
Expected: PASS

### Task 7: Verify the workspace

**Files:**
- Test: `agent-im-relay/packages/core/src/__tests__/artifacts.test.ts`
- Test: `agent-im-relay/packages/discord/src/__tests__/artifacts.test.ts`
- Test: `agent-im-relay/packages/discord/src/__tests__/files.test.ts`

**Step 1: Run focused package tests**

Run: `pnpm --filter @agent-im-relay/core test`
Run: `pnpm --filter @agent-im-relay/discord test`

**Step 2: Run workspace verification**

Run: `pnpm test`
Expected: PASS across the workspace

**Step 3: Build the touched packages**

Run: `pnpm --filter @agent-im-relay/core build && pnpm --filter @agent-im-relay/discord build`
Expected: PASS

**Step 4: Stop after verification**

- Do not expand scope unless verification exposes a regression that blocks file transfer support
