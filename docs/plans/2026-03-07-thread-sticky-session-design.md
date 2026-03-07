# Design: Thread-Sticky Agent Sessions for `agent-im-relay`

**Date:** 2026-03-07
**Status:** Implemented

## Implementation Notes

- Core now persists `threadSessionBindings` and `threadContinuationSnapshots` alongside the legacy state maps.
- Backend streams emit authoritative `session` lifecycle events so confirmed native session IDs are stored before terminal completion.
- The conversation runner now resolves each turn through the sticky thread-session manager and falls back to a continuation snapshot when native resume is unavailable.
- Discord and Feishu regression coverage now asserts that follow-up messages stay on the same sticky thread session until explicit teardown with `/done` or its equivalent.

## Overview

Preserve a single logical agent session for each conversation thread until the user explicitly ends it with `/done`. A follow-up message in the same thread should continue the same session regardless of whether the user says "continue" or sends a brand-new instruction. Native backend resume should be used whenever it is confirmed and reliable. When native resume is unavailable or untrusted, the system should fall back to a platform-neutral continuation snapshot so the thread still behaves like one ongoing session.

This design addresses the current gap where session continuity depends too heavily on a saved backend session ID that is only fully trusted on the happy path. Timeouts, interrupts, and backend-specific lifecycle quirks can leave the thread bound to an ID that does not actually reconstruct the prior agent context, causing the next message in the thread to look like a fresh task.

## Goals

- Treat each thread or conversation as one sticky agent session until `/done`
- Continue the same logical session for any follow-up message in the same thread
- Persist backend-native session IDs as soon as they are confirmed, not only at terminal completion
- Distinguish confirmed, pending, and invalid native session bindings
- Provide a backend-agnostic continuation fallback when native resume is unavailable
- Keep interrupt semantics separate from session teardown
- Apply the same continuity contract across all supported backends

## Non-Goals

- Replacing backend-native resume with full transcript replay in every case
- Building a generic workflow engine for all thread lifecycle state
- Changing slash-command UX beyond what is needed for correct session continuity
- Introducing user-visible "continue" commands as a required part of the flow

## Current Problems

Today, continuity is modeled too narrowly:

- `conversationSessions` stores a single string per conversation
- the runtime may seed that value before the backend has emitted its real resumable session identifier
- the next run in the same thread assumes that saved value is safe to resume
- if the backend did not emit a confirmed session ID before timeout or interruption, the saved value may not restore context
- there is no platform-neutral continuation snapshot to fall back on when native resume is absent or unreliable

This makes thread continuity fragile on unhappy paths and backend-specific lifecycle differences.

## Proposed Architecture

Add a dedicated thread-session continuity layer in core that owns session stickiness and resume eligibility.

```text
packages/core/src/thread-session/
  types.ts
  manager.ts
  __tests__/manager.test.ts
```

The new layer should work alongside the existing conversation runner:

- the conversation runner asks the thread-session manager how to run the next message
- backends report native session lifecycle updates as explicit events
- the manager persists thread bindings and continuation snapshots
- platforms continue to own transport and rendering, but no longer decide whether a thread should start fresh or continue

## State Model

Each thread keeps two related pieces of state.

### Thread Session Binding

- `conversationId`
- `backend`
- `nativeSessionId`
- `nativeSessionStatus`: `pending | confirmed | invalid`
- `lastSeenAt`
- `closedAt?`

This represents the backend-native session currently bound to the thread.

### Thread Continuation Snapshot

- `conversationId`
- `taskSummary`
- `lastKnownCwd`
- `model`
- `effort`
- `whyStopped`: `timeout | interrupted | error | completed`
- `nextStep`
- `updatedAt`

This represents the minimum backend-agnostic handoff needed to keep the thread feeling continuous when native resume cannot be trusted.

## Runtime Data Flow

For every incoming thread message:

1. Resolve the thread binding
2. If the thread has never been started, create a new binding with `nativeSessionStatus = pending`
3. If the thread has an open binding and has not been `/done`, continue that logical session regardless of message text
4. Choose execution mode:
   - `native-resume` when the binding has a `confirmed` native session ID
   - `snapshot-resume` when the thread has an open binding but no confirmed native session ID
   - `fresh-start` only for a brand-new thread or a thread that has been explicitly closed with `/done`
5. Build the backend request:
   - native resume sends the user's new message as incremental input plus native resume parameters
   - snapshot resume injects a hidden continuation handoff plus the user's new message
   - fresh start behaves like the current first-run flow
6. Update continuity state eagerly during the run:
   - when a backend emits a real resumable session ID, mark the binding `confirmed` and persist immediately
   - when a backend emits a signal that the binding is invalid, mark it `invalid`
   - on completion, timeout, interrupt, or error, refresh the continuation snapshot

## Backend Lifecycle Contract

Backends should emit an explicit session lifecycle signal whenever they learn something authoritative about resumability. The current `done.sessionId` signal is not enough because it arrives too late on timeout and abort paths.

The core event model should grow a new event shape, for example:

- `session`: `{ type: 'session', sessionId: string, status: 'confirmed' | 'resumed' }`

Backends should emit this as early as possible:

- Codex: on `thread.started` and `thread.resumed`
- Claude: on any authoritative session event or parsed payload that reveals a resumable `session_id`
- future backends: on their first trustworthy session lifecycle signal

The runner should treat these lifecycle events as the authoritative source for native session persistence.

## Platform Integration

### Discord

- a message in an active thread should always reuse the thread binding until `/done`
- `interrupt` stops the current run only; it does not end the sticky session
- `/done` clears both the native binding and the continuation snapshot for the thread
- Discord should not need to special-case the word "continue"

### Feishu

- the same sticky-session contract applies to the resolved conversation ID
- card actions and normal text messages should keep using the same thread binding until explicit teardown
- managed gateway resume should use the same core continuity manager rather than platform-local heuristics

## User-Visible Behavior

After this change:

- a follow-up message in the same thread should feel like one ongoing agent session
- timeouts and interrupts should not implicitly reset the thread into a fresh session
- the system should avoid reintroducing first-run setup behavior unless the thread was explicitly ended or the backend continuity state is truly unrecoverable
- thread continuity should depend on thread membership, not on the user typing a specific keyword such as "continue"

## Error Handling

The continuity manager should not silently trust uncertain session state.

- if the backend never confirms a native session ID, the binding stays `pending` and later falls back to snapshot resume
- if a backend resume attempt fails in a way that proves the stored session is invalid, the binding becomes `invalid` and the same thread falls back to snapshot resume
- only `/done` fully clears the thread's continuity state
- transient run failures should refresh the snapshot rather than discard thread continuity

## Testing Strategy

Core tests should cover:

- new thread start creates a pending binding rather than a trusted resumable session
- confirmed session lifecycle events persist native session IDs immediately
- timeout before a terminal `done` still preserves thread continuity by snapshot fallback
- interrupt keeps the thread binding open
- `/done` clears both binding and snapshot
- invalid native resumes fall back to snapshot resume on the next message

Backend tests should cover:

- Codex emits confirmed lifecycle events from `thread.started` and `thread.resumed`
- Claude emits confirmed lifecycle events from its authoritative session payloads
- future backends can opt in with the same lifecycle event contract

Platform tests should cover:

- Discord follow-up messages in the same thread reuse the sticky session without requiring a special keyword
- Feishu follow-up messages reuse the same conversation binding
- first-run environment/setup behavior only appears on real fresh starts

## Acceptance Criteria

- Session continuity is modeled as a thread-level sticky session until `/done`
- Any follow-up message in the same thread continues the same logical agent session
- Native session IDs are persisted only after authoritative confirmation
- Timeouts and interrupts do not implicitly tear down the thread session
- Snapshot fallback preserves continuity when native resume is not available
- Core, Discord, and Feishu tests cover the sticky-session contract across happy and unhappy paths
