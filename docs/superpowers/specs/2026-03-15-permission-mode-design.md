# Permission Mode Design

**Date:** 2026-03-15

**Goal:** Add a runtime `permissionMode` with backward-compatible `auto` behavior and a new `safe` mode where dangerous agent operations require explicit approval from Discord, Feishu, or Slack before the backend continues.

## Scope

This design covers:

- `RuntimeConfig.permissionMode: 'auto' | 'safe'` with default `auto`
- `RuntimeConfig.permissionRequestTimeoutMs` with default `120000`
- core runtime support for pending permission requests, timeout handling, and backend stdin writeback
- backend-specific permission request parsing for Codex and Claude
- UI and callback handling for Discord, Feishu, and Slack approval cards
- tests for config parsing, runtime state transitions, backend parsing/writeback, and platform callbacks

Out of scope:

- changing OpenCode behavior beyond preserving compatibility
- persistent cross-process recovery of in-flight permission requests after process restart
- introducing a new broker/service outside the current monorepo runtime

## Constraints

- `auto` mode must remain fully backward compatible
- `safe` mode must keep the same backend process alive while waiting for user input
- timeout defaults to deny and must still let the backend continue
- permission parsing and response protocols are backend-specific and cannot be normalized at the raw protocol level
- IM platforms should render and resolve a unified approval model even if backend payloads differ internally
- conversation execution remains single-active-run per conversation

## Recommended Approach

Use a unified core permission controller layered on top of the existing run lifecycle:

1. backends detect permission requests and emit normalized stream events
2. core runtime registers each pending request, starts its timeout, and exposes a single approve/deny API
3. IM packages render platform-native approval cards from normalized events
4. IM callbacks invoke the core API; core routes the decision back to the correct backend stdin writer

This keeps platform behavior consistent, localizes timeout and cleanup logic in one place, and avoids backend-specific branching in Discord, Feishu, or Slack.

## Architecture

### Runtime config

`packages/core/src/config.ts` should add:

- `permissionMode?: 'auto' | 'safe'`
- `permissionRequestTimeoutMs?: number`

Defaults in the runtime record:

- `permissionMode: 'auto'`
- `permissionRequestTimeoutMs: 120000`

`CoreConfig` should expose both as required resolved values so backends and platform packages do not need to re-implement defaults.

### Stream events

`packages/core/src/agent/session.ts` should extend `AgentStreamEvent` with two new event types:

- `permission-requested`
  - `requestId`
  - `backend`
  - `tool` or operation summary
  - `reason`
  - `expiresAt`
  - optional backend-specific debug payload for logs/tests only
- `permission-resolved`
  - `requestId`
  - `backend`
  - `decision: 'approved' | 'denied' | 'timeout'`

These events define the only permission contract that IM packages consume.

### Core runtime permission controller

`packages/core/src/agent/runtime.ts` currently tracks abort controllers only. It should evolve into a run registry that stores, per conversation:

- abort controller
- backend name
- permission responder bound to the active backend process stdin
- pending permission requests indexed by `requestId`
- timeout timers for pending requests

The runtime should expose focused APIs that IM packages call instead of touching backend internals:

- query pending request state
- approve a request
- deny a request
- reject stale or already-resolved actions

The controller owns:

- one-time resolution semantics
- timeout scheduling
- cleanup on run completion, error, or interruption
- emission of `permission-resolved` after approve/deny/timeout

Late callbacks must be rejected safely without writing to stdin again.

### Backend contract

`packages/core/src/agent/backend.ts` should stay small but gain a way for a running backend stream to register a permission responder with core runtime. The responder remains backend-private in implementation and only accepts normalized decisions from core.

The key boundary is:

- core knows conversation id, request id, and `approved` / `denied`
- backend knows how that decision must be encoded on stdin

This avoids spreading protocol details into runtime or platform code.

## Backend adaptation

### Codex

`packages/core/src/agent/backends/codex.ts` should change in two places:

- argument construction:
  - `auto` mode keeps `--full-auto`
  - `safe` mode omits `--full-auto`
- stream parsing:
  - detect Codex permission request events from the JSON stream
  - emit normalized `permission-requested`
  - register a Codex-specific stdin responder for the active run

Existing parsing for session lifecycle, command execution, text, and error events must remain unchanged.

### Claude

`packages/core/src/agent/tools.ts` and `packages/core/src/agent/backends/claude.ts` should change together:

- `auto` mode keeps `--dangerously-skip-permissions`
- `safe` mode omits the skip-permissions flag
- Claude stream-json parsing detects permission request messages and emits normalized `permission-requested`
- the backend registers its own stdin responder for approve/deny

The Claude parser must preserve current support for assistant deltas, tool summaries, session ids, and authoritative resume failures.

### OpenCode

`packages/core/src/agent/backends/opencode.ts` should remain behaviorally unchanged. It does not need synthetic permission support. The only requirement is that the new runtime configuration does not break it.

## Platform presentation

All platforms should render a card/block/button set from the normalized request:

- title: permission required
- backend name
- short operation summary
- short reason
- expiration hint based on `expiresAt`
- actions: approve, deny

Each platform must treat the request as single-use and update the original UI to a terminal state after resolution.

### Discord

Discord currently lacks a button callback path for this workflow. It should add:

- button interaction handling in `packages/discord/src/index.ts`
- a small permission card builder near the stream/presentation layer
- a callback handler that validates `conversationId` and `requestId`, calls the core permission API, and edits the message to show the final decision

If a user clicks after timeout or after another user has already acted, Discord should respond ephemerally with an expired/already-handled message.

### Feishu

Feishu already has card action routing. It should add:

- permission card payload builders in `packages/feishu/src/cards.ts`
- permission action routing in `packages/feishu/src/events.ts` and/or `packages/feishu/src/runtime.ts`
- card update logic to mark approved, denied, or timed out

Permission actions should use distinct action types rather than piggybacking on existing session control commands.

### Slack

Slack already supports interactive blocks and action routing. It should add:

- permission block builders in `packages/slack/src/cards.ts`
- permission action handling in `packages/slack/src/runtime.ts`
- a dedicated in-memory pending-permission map separate from pending-run setup state

This separation is important because permission approval happens during an active run, not before a run starts.

## Timeout and state model

Each permission request uses the same state machine:

- `pending`
- `approved`
- `denied`
- `timeout`

Rules:

- only `pending` may transition
- first resolution wins
- timeout resolves as deny and writes the backend-specific deny payload to stdin
- after any terminal state, the controller clears the timer and rejects duplicate callbacks

Run shutdown semantics:

- normal completion clears all pending requests
- errors and interruptions clear all pending requests
- `/done` or equivalent session cleanup must leave no live permission timers behind

## Testing strategy

Use TDD per slice.

Required coverage:

- `packages/core/src/__tests__/config.test.ts`
  - default `permissionMode`
  - default `permissionRequestTimeoutMs`
  - config parsing of explicit `safe`
- `packages/core/src/__tests__/backends/codex.test.ts`
  - `safe` omits `--full-auto`
  - permission request extraction
  - approve/deny writeback encoding
- `packages/core/src/__tests__/backends/claude.test.ts`
  - `safe` omits skip-permissions flag
  - permission request extraction
  - approve/deny writeback encoding
- `packages/core/src/agent/__tests__/runtime.test.ts`
  - request registration
  - timeout auto-deny
  - duplicate resolution rejection
  - cleanup on run termination
- `packages/discord/src/__tests__`
  - permission button render
  - approve/deny callback handling
  - stale click handling
- `packages/feishu/src/__tests__`
  - permission card payloads
  - action routing to core
  - terminal-state card updates
- `packages/slack/src/__tests__`
  - permission blocks
  - action routing
  - stale/duplicate action handling

## Risks

- Codex and Claude may expose permission events with subtly different payload shapes than the rest of their stream events
- stdin writeback must not race with run teardown
- platform callbacks can arrive after timeout or after the run has exited
- Slack and Discord interaction payload limits may require concise request summaries

## Delivery notes

- Branch: `feat/permission-mode`
- Preserve `auto` mode behavior exactly
- Keep backend protocol handling private to each backend file
- Prefer a shared core controller over duplicating timeout or pending-state logic in IM packages
