# Slack Experience V2 Design

**Date:** 2026-03-13

**Goal:** Upgrade the Slack bot experience so channel mentions, direct messages, emoji feedback, and streaming output behave like first-class conversation entry points without broad core refactoring.

## Scope

This design covers:

- `app_mention` support for starting a new Slack conversation from a channel root message
- direct-message conversation startup and continuation
- Slack startup presence updates via `users.setPresence`
- reaction-based progress feedback aligned with Discord semantics
- streaming message updates aligned with Discord semantics
- fixing the existing `@agent-im-relay/slack` package entry resolution failure in `apps/agent-inbox`

Out of scope:

- core platform-model refactors
- Slack OAuth or distribution flows
- unrelated Discord or Feishu behavior changes

## Constraints

- `app_mention` only starts a new session when the mention happens in a channel root message
- mentions inside an existing mapped thread continue that thread conversation instead of starting a new one
- DM conversations reuse the existing thread-first model, but Slack DM slash commands may require the bot to create a root message because slash payloads do not provide a user message timestamp
- do not reuse the prior erroneous `packages/slack/src/runtime.ts` mention implementation; rewrite the mention flow from scratch
- package boundaries should stay local to `packages/slack` unless a shared abstraction is already clear

## Recommended Approach

Keep the existing Slack package but reorganize runtime behavior into three responsibilities:

1. routing: classify incoming Slack events as channel mention startup, DM startup, mapped-thread continuation, or control command
2. launch: handle conversation mapping, backend/model gating, pending runs, and session startup
3. presentation: own reactions, stream message lifecycle, and final completion/error display

This keeps the change focused in `packages/slack`, mirrors how Discord and Feishu separate concerns, and avoids turning the PR into a cross-platform rewrite.

## Architecture

### Routing layer

Slack ingress should distinguish:

- `app_mention` on a channel root message: create a conversation bound to the mentioned message thread root
- `app_mention` inside a mapped thread: treat as a normal in-thread message and continue the existing conversation
- DM user message without an existing mapping: create a DM-backed conversation
- DM or channel thread reply with an existing mapping: continue the mapped conversation
- slash commands: keep global handling, including support inside DM containers

Unmapped channel messages that are not root mentions stay ignored. Bot-authored messages stay ignored.

### Launch layer

Conversation ids remain based on `threadTs` / root timestamp. Slack state stores enough metadata to drive edits and updates:

- `conversationId`
- `channelId`
- `threadTs`
- `rootMessageTs`
- `containerType: 'channel-thread' | 'dm'`

Pending runs remain one-per-conversation, with extra source metadata for presentation decisions:

- `source: 'app_mention' | 'dm-message' | 'slash-command'`

For DM slash commands, the runtime should post a root message first, then reuse that message timestamp as the conversation root so the rest of the flow matches thread handling.

### Presentation layer

Slack should expose the same user-visible lifecycle as Discord:

- apply emoji reactions on the triggering user message when Slack gives us a message entity
- use a dedicated streaming reply message updated via `chat.update` during the run
- keep backend/model selection in card messages separate from the runtime streaming message
- degrade gracefully when reactions or updates fail by falling back to ordinary messages

The minimum phase set should cover `received`, `thinking`, `tool_running`, `done`, and `error`.

## Event Flows

### Channel `app_mention`

1. Receive `app_mention`
2. If message is a channel root message, bind conversation to that message `ts`
3. Post backend/model selection inside the message thread
4. Resume the run once setup completes
5. Stream output into a dedicated bot reply in the same thread
6. Apply final reaction / completion state

### Existing mapped thread

1. Receive thread message or thread mention
2. Resolve conversation by `thread_ts`
3. Reuse existing backend/session state
4. Continue conversation and update the current stream message

### DM user message

1. Receive a DM message from a user
2. If the DM conversation is not mapped yet, create a new conversation using that message `ts`
3. Run backend/model setup if needed
4. Stream output back into the DM thread

### DM slash command

1. Receive `/code` or `/ask` in DM
2. Post a root bot message in the DM
3. Map that root message timestamp as the conversation id
4. Reuse the same backend/model/session pipeline as every other Slack conversation

## Testing Strategy

Use TDD for each slice.

Required coverage:

- routing of channel mention root messages vs mapped thread mentions
- DM first-message startup and DM continuation
- DM slash command root-message creation
- presence update on startup
- reaction phase transitions and failure tolerance
- streaming message update behavior, including fallback when updates fail
- package entry resolution for `@agent-im-relay/slack` in `apps/agent-inbox`
- regression coverage for existing slash commands and pending-run behavior

## Risks

- Slack event payload differences between channel threads and DMs can easily cause misrouting
- reaction permissions may vary by workspace/channel
- streaming updates can hit Slack API rate limits if update cadence is too aggressive
- package-entry fixes must work for both test-time workspace imports and built distribution output

## Delivery Notes

- Implement in the isolated worktree on branch `feat/slack-experience-v2`
- Preserve existing Slack package boundaries; prefer small focused files over runtime accretion
- Verify targeted Slack tests first, then the full workspace baseline, and explicitly account for the current `apps/agent-inbox` Slack import failure as part of this branch
