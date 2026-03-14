# Slack Adapter Design

**Date:** 2026-03-12

**Goal:** Add a first-party Slack platform package that plugs into the existing core adapter interfaces, uses Socket Mode for events and interactions, and preserves the project's thread-first conversation model.

## Scope

This design covers:

- A new `packages/slack` package for Slack bot runtime and adapter code
- `PlatformAdapter` support for Slack message sending, conversation management, status updates, interactive UI, and Markdown formatting
- Socket Mode subscriptions for slash commands, message events, and Block Kit interactions
- Thread-based conversation mapping for Slack
- Backend/model selection cards implemented with Block Kit
- Slash commands: `/code`, `/ask`, `/interrupt`, `/done`, `/skill`
- Core registration updates for `slack` as a supported relay platform
- Slack-specific state persistence paths
- Reuse or extraction of Feishu runtime logic for pending runs and model-selection timeout handling where that logic is genuinely platform-agnostic

Out of scope:

- Slack OAuth distribution or multi-workspace app installation flows
- Rich Slack surfaces beyond thread messages, slash commands, and Block Kit interactions
- Refactoring unrelated Discord behavior

## Product Constraints

- `/code` and `/ask` always create a new Slack thread, regardless of whether the command is invoked from a channel, an existing thread, or a DM.
- The newly created Slack thread becomes the conversation mapping key for the run.
- Public Block Kit messages inside the thread are used for backend/model selection and status updates; all participants can see them.
- Slash commands are handled globally.
- Ordinary messages are handled only inside active Slack conversation threads that the bot created or joined as part of a mapped conversation.
- Main-channel ordinary messages are ignored.
- Bot-authored messages are ignored.
- The implementation should follow existing package boundaries from `packages/discord` and `packages/feishu`.

## Recommended Approach

Use a dedicated `packages/slack` package with runtime, adapter, command, card, and formatting modules, mirroring the separation already used for Discord and Feishu.

This approach keeps Slack-specific transport concerns isolated while allowing shared run-gating behavior to move into core only when the shared abstraction is clear. It avoids turning this feature into a broad cross-platform refactor while still making room to extract reusable logic from Feishu where Slack demonstrably needs the same state machine.

## Architecture

### Package layout

The new package should follow the existing platform-package pattern:

- `packages/slack/src/index.ts`: package entry point and runtime bootstrap
- `packages/slack/src/config.ts`: Slack environment and runtime configuration
- `packages/slack/src/adapter.ts`: `PlatformAdapter` implementation
- `packages/slack/src/runtime.ts`: Socket Mode event routing and run orchestration
- `packages/slack/src/conversation.ts`: thread mapping helpers and persistence integration
- `packages/slack/src/cards.ts`: Block Kit builders for backend/model selection and thread controls
- `packages/slack/src/commands/`: slash command parsing/dispatch helpers
- `packages/slack/src/formatting.ts`: Markdown to Slack `mrkdwn` conversion
- `packages/slack/src/__tests__/`: package-level unit tests

Core changes stay limited to registration, platform inference, and shared-state helpers:

- `packages/core/src/relay-platform.ts`
- `packages/core/src/paths.ts`
- `packages/core/src/persist.ts` and/or adjacent state helpers if Slack persistence shape needs explicit support
- Shared pending-run/model-selection helpers only if Feishu logic can be extracted cleanly without platform leakage

### Adapter responsibilities

Slack implements the following capabilities from `packages/core/src/types.ts`:

- `MessageSender`: send/edit thread messages, including text and optional Block Kit payloads
- `ConversationManager`: create new Slack threads for `/code` and `/ask`, resolve conversation ids from Slack message context
- `StatusIndicator`: expose run state in-thread using visible Slack messages or message updates
- `InteractiveUI`: show backend/model selection menus and await results from Block Kit actions
- `MarkdownFormatter`: convert Markdown output into Slack `mrkdwn` and optional Block Kit sections

## Event Model

### Slash commands

- `/code` and `/ask` acknowledge quickly, create a new thread in the current container, persist the new conversation mapping, then begin the requested run
- `/interrupt`, `/done`, and `/skill` operate on the mapped conversation for the current Slack thread
- When control commands are invoked outside a mapped conversation thread, the runtime responds with a visible error telling the user to start with `/code` or `/ask`

### Ordinary messages

- Only non-bot messages inside mapped Slack conversation threads are converted into `IncomingMessage`
- Channel messages outside mapped threads are ignored
- This keeps Slack aligned with the existing thread-first platform model

### Interactive actions

- Backend and model selection cards post to the mapped thread as public Block Kit messages
- Actions mutate the same persisted pending-run state rather than spawning duplicate gates
- Card updates happen in place so the thread retains a readable history of current backend/model state and pending execution state

## Conversation Mapping

- Slack conversation ids should use the thread root identifier so they remain stable for the lifetime of the thread
- Persistence must retain enough data to route edits, uploads, and interaction callbacks:
  - Slack channel id
  - thread/root timestamp
  - root message timestamp if Slack API calls need it separately
- `/code` and `/ask` always create a fresh mapping
- Ordinary thread replies reuse the existing mapping

## Run Gating and Reuse of Feishu Logic

Slack needs the same run-gating semantics already implemented in Feishu:

- Block execution when backend selection is required
- Block execution when the chosen backend requires a model but no model is configured
- Keep one pending run per conversation while waiting for user input
- Support model-selection timeout behavior so pending runs do not disappear silently

Preferred extraction rule:

- If the gating logic can be expressed without Feishu transport or card payload types, move it into core
- If not, keep the first Slack implementation local but structure it to match Feishu behavior and extract later

The goal is behavior parity, not forced abstraction.

## Markdown Rendering

Slack formatting should be conservative and readable rather than trying to reproduce every Markdown construct exactly.

Expected conversions:

- headings -> emphasized lines
- links -> Slack link syntax
- code fences -> triple-backtick blocks
- inline code -> backticks
- blockquotes -> `>`
- lists -> plain bullet/number prefixes
- tables -> preformatted text fallback

If a Discord formatter currently relies on embeds, Slack should prefer `mrkdwn` text plus small Block Kit sections/context blocks rather than inventing a second rich-output path for the same content.

## Error Handling

- Socket Mode command and interaction payloads must be acknowledged before longer-running work starts
- Slack transport failures should surface visible feedback when possible and emit logs with enough context to diagnose channel/thread/action failures
- Missing conversation mappings, stale interactions, expired pending runs, and thread-creation failures should all return explicit user-facing errors
- `/interrupt` and `/done` must clear pending runs, timers, and stale card state to avoid leaving threads in a blocked state

## Testing Strategy

At minimum, tests should cover:

- Slash command handling and mandatory new-thread creation
- Slack thread to conversation mapping and ordinary-message filtering
- Backend/model selection card construction and action parsing
- Pending run reuse and timeout behavior
- Markdown to Slack `mrkdwn` conversion
- Core registration and persistence changes for Slack
- Regression coverage to ensure existing core and Feishu behavior stays intact

Tests should be written first for each slice and verified to fail before implementation, following the repository's TDD workflow.

## Delivery Plan

Implementation should happen in an isolated git worktree, with package-focused verification as each slice lands. Because the current baseline contains pre-existing Discord failures unrelated to Slack, Slack work should maintain the accepted baseline and avoid introducing new failures in core or Feishu.
