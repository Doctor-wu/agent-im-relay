# Design: Feishu Session Chats for `agent-im-relay`

**Date:** 2026-03-08
**Status:** Approved

## Overview

Refactor the Feishu conversation model so that private chats no longer carry long-lived agent sessions directly. Instead, each qualifying private message becomes a session factory action: the bot creates a new Feishu group chat containing only the user and the bot, posts the initial prompt into that group, and treats that group `chat_id` as the authoritative `conversationId`.

This aligns Feishu behavior with Discord's thread-first mental model:

- Discord: `@bot` in a channel creates a thread, and the thread is the session container
- Feishu: direct message to the bot creates a dedicated session group, and that group is the session container

The private chat becomes an index and launch surface, not the execution surface.

## Goals

- Make Feishu session boundaries feel like Discord thread boundaries
- Ensure each private-chat launch creates a fresh, isolated session container
- Use the new session group's `chat_id` as the authoritative `conversationId`
- Send an index/receipt message back to the private chat after session creation
- Keep follow-up conversation, files, cards, and `/done` semantics scoped to the session group

## Non-Goals

- Reusing one fixed session group per user
- Continuing old sessions directly from private chat
- Reworking Discord behavior
- Turning all Feishu group chats into session groups automatically

## Product Model

### Private Chat

The private chat is a session launcher and session index:

- user sends the bot a new task or question
- bot creates a new session group
- bot sends an index message back in the private chat with:
  - session group name
  - session group identifier or jump target
  - prompt preview
  - creation time

The private chat does not directly run `runFeishuConversation()` after this change.

### Session Group

The session group is the Feishu equivalent of a Discord thread:

- created per private-chat launch
- contains only the user and the bot
- first user prompt is routed into this group
- all follow-up messages in the group continue the same session
- `conversationId` is the session group's `chat_id`

## Conversation Routing Rules

### Private Chat Messages

When the bot receives a `p2p` message:

1. parse the incoming prompt and attachments
2. create a new session group
3. send an index message back to the private chat
4. post the original prompt into the new session group
5. start the agent run against the session group `chat_id`

The original private chat `chat_id` is not used as the conversation key.

### Session Group Messages

When the bot receives a message inside a bot-created session group:

- treat the session group's `chat_id` as the conversation key
- continue using the existing Feishu runtime behavior for prompt parsing, file ingest, card actions, and sticky session continuation

### Other Feishu Groups

Ordinary group chats outside this session-group flow should stay outside the new abstraction unless implementation deliberately keeps legacy group behavior. The MVP should optimize for the private-chat-to-session-group path first.

## Session Group Creation

The bot should create a new Feishu group chat for every qualifying private-chat launch.

Suggested group naming shape:

- creator display name
- prompt preview
- short timestamp or short id

Examples:

- `Alice · Fix relay startup · 14:32`
- `Bob · Review deployment plan · a1f4`

The first implementation should keep naming deterministic and short enough for Feishu chat title limits.

## Indexing and Persistence

Private chat should act as an index over created session groups.

Persist a minimal Feishu session-chat mapping record containing:

- `sourceP2pChatId`
- `sourceMessageId`
- `sessionChatId`
- `creatorOpenId`
- `createdAt`
- `promptPreview`

This enables:

- private-chat launch receipts
- later "recent sessions" UX
- debugging and reconciliation when a session group is created but later message delivery fails

This mapping belongs in Feishu-owned state unless implementation proves it should move into shared core.

## Error Handling

- If session-group creation fails, reply in the private chat with a clear failure and do not start the run
- If group creation succeeds but initial prompt delivery fails, reply in the private chat with partial-failure context
- If private-chat index message fails, do not roll back the group; log the failure and continue the session-group flow
- If the bot lacks permission to create a group or add the user, surface that directly in the private chat
- If session-group creation succeeds but the agent run is already blocked or busy, treat that as a group-scoped runtime issue, not a private-chat issue

## State Semantics

- `conversationId` for Feishu runtime becomes the session group's `chat_id`
- `/done` and done card actions clear only the session-group continuation
- private-chat launch receipts remain as durable index entries and are not themselves conversation sessions

## Testing Strategy

### Unit Tests

- private chat event is recognized as a session-factory event
- session-group creation request is built correctly
- private-chat index message payload is built correctly
- session-group routing uses `sessionChatId` rather than `sourceP2pChatId`

### Integration Tests

- private chat prompt creates a session group and starts the run there
- follow-up message in the session group reuses the same `conversationId`
- `/done` only clears the session-group continuation
- index message appears in the private chat after group creation
- create-group failure and post-index failure produce visible feedback

## Acceptance Criteria

- Direct message to the Feishu bot creates a fresh session group
- The new session group contains only the user and the bot
- The first agent run executes in the session group, not in the private chat
- The private chat receives an index/receipt message for the new session group
- Follow-up messages in the session group continue the same session
- Session state is scoped to the session group `chat_id`
