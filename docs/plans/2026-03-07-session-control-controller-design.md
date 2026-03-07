# Design: Session Control Controller for `agent-im-relay`

**Date:** 2026-03-07
**Status:** Implemented

## Overview

Promote conversation session controls from a thin shared state helper into a dedicated controller in `@agent-im-relay/core`. The controller should own the semantic meaning of `interrupt`, `done`, backend changes, model changes, and effort changes, while Discord and Feishu remain responsible for transport and UI.

This design targets the current gap where both platforms already share basic state mutations through `applyConversationControlAction()`, but still duplicate result interpretation, persistence timing, confirmation handling, and user-facing follow-up behavior.

## Goals

- Introduce a first-class core controller for session-control commands
- Standardize the command and result model for `interrupt`, `done`, `backend`, `confirm-backend`, `cancel-backend`, `model`, and `effort`
- Return explicit controller effects so platforms know when to persist, confirm, clear continuation state, or refresh UI
- Reduce direct platform access to shared state maps for session-control flows
- Keep the change incremental and compatible with the current Discord and Feishu runtime model

## Non-Goals

- A full platform-neutral abstraction for cards, buttons, slash commands, or forms
- Folding first-run backend setup into this controller
- Replacing current conversation execution or streaming logic
- Introducing a generic state machine for all platform interactions

## Current Problems

Today, the shared layer stops at state mutation:

- `@agent-im-relay/core` exposes `applyConversationControlAction()` in `packages/core/src/platform/conversation.ts`
- Feishu uses the result but still owns action translation, confirmation branching, and follow-up flow details
- Discord command handlers still mutate shared maps and trigger persistence directly
- There is no single result contract that tells platforms whether an action requires persistence, clears continuation, or needs confirmation UX

This keeps the mutation logic shared, but leaves the higher-level meaning of actions split across platform packages.

## Proposed Architecture

Add a dedicated controller module in core:

```text
packages/core/src/session-control/
  controller.ts
  types.ts
  __tests__/controller.test.ts
```

The controller becomes the only place that decides:

- whether an action is valid
- whether an action changes shared state
- whether the continuation session is cleared
- whether backend switching needs confirmation
- whether platforms should persist state after the action
- which normalized summary or message key describes the outcome

`packages/core/src/platform/conversation.ts` should then either delegate to the controller or keep only run-related helpers such as `runPlatformConversation()` and `evaluateConversationRunRequest()`.

## Command Model

The controller command surface should be close to current action types to minimize migration cost:

- `interrupt`
- `done`
- `backend`
- `confirm-backend`
- `cancel-backend`
- `model`
- `effort`

Each command includes `conversationId`. Commands that mutate settings include a `value`.

The controller may later grow optional metadata, but this round should avoid introducing platform-specific fields.

## Result Model

The controller should return a normalized result object with:

- `kind` — the resolved action result kind
- `conversationId`
- `stateChanged` — whether shared state changed
- `persist` — whether the caller should persist state
- `clearContinuation` — whether the saved continuation session was cleared
- `requiresConfirmation` — whether the platform must render a confirmation step
- `summaryKey` — a platform-neutral outcome key such as `interrupt.noop`, `interrupt.ok`, `backend.confirm`, `backend.updated`

Action-specific fields remain allowed when needed:

- `interrupted` for `interrupt`
- `currentBackend` and `requestedBackend` for backend confirmation
- `backend` for confirmed backend changes

This keeps platform branching driven by a stable controller contract rather than implicit knowledge of state maps.

## Platform Integration

### Discord

Discord slash command handlers should stop directly mutating session-control state where possible. Instead:

- parse command input
- send controller command
- persist when `result.persist === true`
- render Discord-specific ephemeral replies based on `summaryKey` and action-specific fields

Discord still owns slash-command registration, message copy, and thread-only guards.

### Feishu

Feishu card action dispatch should also call the controller rather than reinterpreting raw action types in package-local logic. Feishu still owns:

- card payloads
- confirmation card rendering
- action payload decoding
- transport decisions for text versus card replies

The controller decides whether a backend change needs confirmation and whether a continuation is cleared after confirmation.

## Persistence and Side Effects

The controller should not persist state by itself. It should return explicit effect flags so the platform can decide when to call `persistState()`.

This keeps the controller deterministic and testable while preserving current platform control over async side effects.

Expected pattern:

1. platform receives user action
2. platform translates action into controller command
3. controller mutates shared in-memory state and returns normalized result
4. platform persists if requested
5. platform renders platform-specific response

## Error Handling

The controller should avoid throwing for normal user actions. Invalid or no-op cases should produce structured results whenever possible.

Examples:

- interrupt on an idle conversation returns `interrupt` with `interrupted: false`
- cancel-backend with no pending change returns `cancel-backend` without error
- backend change to the current backend returns a normal updated result instead of a confirmation request

Only programmer errors, such as unsupported command shapes passed from internal code, should fail fast.

## Testing Strategy

Core tests should cover:

- interrupt on active and idle conversations
- done clearing continuation state without interrupt semantics
- backend confirmation path
- backend confirm and cancel paths
- model and effort updates
- normalized effect flags for persistence and confirmation

Platform regression tests should verify:

- Discord replies stay behaviorally unchanged after swapping to the controller
- Feishu card actions still map to the same visible outcomes
- Backend switch confirmation semantics remain unchanged

## Acceptance Criteria

- A controller module exists in `@agent-im-relay/core` for session-control commands
- Discord and Feishu both consume controller results instead of owning session-control semantics independently
- Persistence timing is driven by normalized controller effects
- Existing session-control behavior remains unchanged from a user perspective
- Core, Discord, and Feishu tests continue to pass
