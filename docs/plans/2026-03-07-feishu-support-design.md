# Design: Feishu Support for `agent-im-relay`

**Date:** 2026-03-07
**Status:** Approved

## Overview

Add a new Feishu platform package that gives `agent-im-relay` a high-fidelity Feishu bot experience while keeping this round scoped to a pragmatic adapter-first implementation. The Feishu adapter should default to code-mode conversations, use card-driven controls instead of relying on typed commands, support inbound and outbound files, and record the follow-up abstractions that should later move into `@agent-im-relay/core`.

## Goals

- Add a new `packages/feishu` package that can run independently from the Discord adapter
- Default Feishu conversations to `code` mode and keep `ask` as an explicit lightweight entry
- Require backend selection before the first run of a new Feishu conversation
- Support conversation mapping across private chats, group reply chains, and group fallback chats
- Support user-to-agent file input and agent-to-user artifact return
- Reuse existing core session state, backend selection, model, effort, cwd, and artifact storage where practical
- Record which platform-specific behaviors should later be extracted into `@agent-im-relay/core`

## Non-Goals

- Fully generalize every Discord-specific workflow before shipping Feishu
- Cross-platform shared conversations
- A complete platform-neutral UI abstraction for cards, menus, and forms in this round
- Replacing Discord's current entry flow with the new Feishu-first interaction model

## Approach

Use a gradual extraction strategy:

1. Add `packages/feishu` for Feishu-specific ingress, cards, file I/O, and message rendering
2. Extract only the minimum shared execution helpers that Feishu and Discord both need
3. Leave richer interaction abstractions in the Feishu package for now, but document them as future core candidates

This avoids copying the entire Discord runtime while also avoiding a large speculative refactor of the whole workspace.

## Conversation Model

Conversation IDs map from Feishu context using these rules:

- Private chat: use `chat_id`
- Group reply chain: use `root_message_id`
- Group non-reply message: fall back to `chat_id`
- Card interactions: restore the saved `conversationId` from card action payload metadata

This keeps group conversations close to Discord thread behavior where possible without requiring a Feishu-native thread abstraction.

## Interaction Model

Feishu uses message-triggered execution and card-driven controls:

- Private chat messages default to `code` mode
- Group messages require `@bot` to trigger execution
- `ask` remains available as an explicit command-like entry for lightweight question mode
- First run in a new conversation must pause for backend selection
- After backend selection, the adapter reuses the saved backend until the user explicitly changes it
- Session controls such as `interrupt`, `done`, backend switching, model switching, effort switching, and cwd updates are exposed through cards or action flows rather than requiring typed commands

## Package Layout

Suggested Feishu package modules:

```text
packages/feishu/src/
  index.ts         # startup, HTTP ingress, event routing
  config.ts        # app credentials, signing, callback config
  message.ts       # send and update Feishu messages/cards
  conversation.ts  # Feishu event -> conversationId mapping
  cards.ts         # backend picker, session card, status card
  files.ts         # inbound file download and outbound artifact upload
  runtime.ts       # shared conversation runner integration
  commands/ask.ts  # explicit ask-mode entry parsing
```

The package should depend on `@agent-im-relay/core` but keep Feishu transport, card payloads, and callback handling local to the package.

## Shared Runtime Boundary

This round should move only stable, obviously reusable logic into core:

- A platform-agnostic "run one conversation" helper that is not named or shaped around Discord mention threads
- Shared attachment prompt augmentation helpers
- Shared artifact manifest parsing, validation, and staging logic

The final upload or render step remains platform-owned because Discord and Feishu have different message and file APIs.

## Future Core Extraction Ledger

This ledger records abstractions intentionally deferred from this adapter-first round. Keep them in `packages/feishu` unless implementation proves the shared behavior is stable enough to move into `@agent-im-relay/core` now.

These items should be documented now and deferred unless implementation proves they are immediately required:

- Unified session control action semantics for `interrupt`, `done`, `resume`, `clear`, and `compact`
- A shared first-run setup flow for backend selection
- Platform-neutral abstractions for rich interactions such as buttons, pickers, and form submissions
- A shared conversation settings workflow for backend, model, effort, and cwd updates
- Stream rendering policies for status updates, message replacement, and incremental output presentation

## File Flow

Inbound files:

1. Feishu adapter receives message/file metadata
2. Adapter downloads files into the existing per-conversation artifact directory
3. Adapter records metadata via the shared artifact store
4. Prompt augmentation prepends local file paths and lightweight summaries before the agent run

Outbound files:

1. Agent ends the final answer with an `artifacts` fenced JSON block
2. Shared artifact logic validates paths and copies approved files into outgoing storage
3. Feishu adapter uploads approved files back to the conversation
4. Warnings for invalid or failed uploads are surfaced without failing the whole run

## State and Status Flow

- New conversation: present backend selection before launching the agent
- Active run: update a single status message/card from `thinking` to `tool_running` to `done` or `error`
- `interrupt`: stop the active run but preserve saved session state
- `done`: clear the saved session so the next run starts fresh
- Backend switch: require explicit confirmation because it changes continuation semantics

## Error Handling

- Reject invalid Feishu signatures or malformed callback payloads before business logic runs
- Deduplicate retried event deliveries so one user action does not start multiple agent runs
- If a card action loses conversation context, return a visible "conversation expired" response
- If file download or upload fails, warn clearly and continue the text response when possible
- If a conversation is already active, reject concurrent execution on the same `conversationId`

## Testing Strategy

Unit tests:

- conversation ID mapping across private chat, reply chain, group fallback, and card actions
- backend selection gate before first run
- default `code` mode versus explicit `ask`
- attachment ingest and artifact return behavior
- card action to session-control mapping

Integration tests:

- first-run backend selection to successful execution
- streaming status updates and completion
- interrupt and done flows
- inbound and outbound file flows
- retry deduplication

Regression tests:

- existing Discord package behavior remains unchanged
- shared core tests still pass after runtime extraction

## Acceptance Criteria

- `packages/feishu` can start independently and receive Feishu bot events
- New Feishu conversations default to `code` mode
- `ask` remains available as an explicit user-triggered path
- First run of a new conversation requires backend selection
- Conversation IDs follow the private chat / reply chain / chat fallback mapping rules
- Inbound file upload and outbound artifact return both work
- Session controls include at least `interrupt`, `done`, backend switching, model switching, and effort switching
- Discord package continues to pass its existing tests
