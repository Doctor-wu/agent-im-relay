# Design: Feishu Long Connection Runtime for `agent-im-relay`

**Date:** 2026-03-08
**Status:** Approved

## Overview

Refactor the Feishu adapter from local HTTP callback ingress to a direct Feishu long-connection runtime. The local process should establish the Feishu event connection itself, receive message, file, and card-action events without exposing a public callback endpoint, and continue to reuse the existing `@agent-im-relay/core` conversation orchestration and local state model.

This is a hard cut. Do not preserve callback-server compatibility, managed gateway startup modes, or any dual-stack bridge path.

## Goals

- Replace local Feishu HTTP callback ingress with Feishu long connection
- Keep all execution local so no user needs to deploy or expose any service
- Preserve the existing conversation runtime boundary in `packages/feishu/src/runtime.ts`
- Continue supporting:
  - text message execution
  - file ingestion
  - artifact/file return
  - backend selection cards
  - session control cards
- Keep Discord behavior unchanged

## Non-Goals

- Keeping `createFeishuCallbackHandler`, `/feishu/callback`, or `/healthz`
- Keeping managed relay / gateway bridge startup paths
- Adding a fallback callback mode
- Refactoring Discord around the new Feishu ingress model

## Assumptions

- Feishu long connection can deliver the message, file, and card-action events required by the current Feishu interaction model
- If implementation proves the card-action event is not actually delivered through long connection in our app configuration, this work should degrade by removing clickable control handling rather than reintroducing callback ingress
- Existing `api.ts` message, card, and file senders remain valid and do not need transport-level redesign

## Architecture

### Startup Model

`packages/feishu/src/index.ts` should start a Feishu runtime client instead of an HTTP server:

- read Feishu config
- initialize shared local state
- create the Feishu API client used for outgoing replies
- create the Feishu long-connection client and event dispatcher
- register event handlers
- open the long connection and keep the process alive

The package entrypoint should expose runtime-oriented APIs such as:

- `createFeishuRuntime()`
- `startFeishuRuntime()`

It should no longer expose server-oriented APIs.

### Module Responsibilities

- `config.ts`
  - read Feishu app credentials and base URL
  - remove port- and callback-specific settings
- `index.ts`
  - runtime startup and shutdown
  - long-connection lifecycle ownership
- `events.ts` or equivalent event-adapter module
  - normalize Feishu long-connection payloads into the local runtime shape
  - route message, file, and card-action events
- `conversation.ts`
  - keep conversation ID extraction and message parsing
- `cards.ts`
  - keep current card payload structures unless long-connection action payloads force a small metadata adjustment
- `runtime.ts`
  - remain the local Feishu orchestration layer
- `api.ts`
  - continue sending text, card, and file replies through Feishu APIs

### Boundary Decisions

- Only ingress changes from HTTP callback to long connection
- Outgoing transport stays Feishu API driven
- `@agent-im-relay/core` stays unaware of Feishu ingress mode
- Any Feishu SDK payload shape differences must be contained in the event-adapter layer

## Event Flow

### Message Event

1. Long-connection runtime receives a message event.
2. The event adapter normalizes sender, message, and header fields into the shapes already expected by `conversation.ts`.
3. The runtime derives `conversationId` from the Feishu context.
4. If the message contains a file reference, the runtime downloads and stages the attachment.
5. If the message is an executable text or mention event, the runtime calls `runFeishuConversation()`.
6. The run publishes text, cards, and files back through the existing Feishu API client.

### Card Action Event

1. Long-connection runtime receives the card-action event.
2. The event adapter extracts the existing card action metadata:
   - `conversationId`
   - `chatId`
   - `replyToMessageId`
   - `action`
   - `value`
   - `prompt`
   - `mode`
3. The runtime calls `handleFeishuControlAction()`.
4. Backend confirmation cards are re-sent through `api.ts`.
5. Resumed runs continue through `resumePendingFeishuRun()`.

### File Event

1. Long-connection runtime receives the file message event.
2. The runtime downloads the file via Feishu API.
3. The runtime queues the attachment in the existing pending-attachment store.
4. The next prompt in that conversation reuses the queued attachment set.

## Data and State

Local state ownership remains unchanged:

- conversation sticky sessions
- backend/model/effort preferences
- pending attachments
- pending backend-selection runs
- artifact staging and retention

Only transport state changes:

- no local HTTP server state
- no callback signature verification state
- no managed gateway bridge state

## Error Handling

- Invalid startup config should fail fast before connecting
- Long-connection disconnects should retry with clear logs
- Authentication/configuration failures should surface as terminal startup errors
- Missing or malformed card-action payloads should be logged and ignored
- File download failures should send a short user-visible error without crashing the runtime
- Concurrent runs on one conversation should preserve the current busy behavior

## Testing Strategy

### Unit Tests

- message event normalization
- card-action event normalization
- conversation mapping
- attachment queueing
- backend-selection resume flow

### Runtime Tests

- long-connection message event triggers `runFeishuConversation()`
- long-connection file event queues attachments
- long-connection card action triggers control handling
- backend confirmation card flow still works
- runtime startup registers handlers and starts the long connection

### Regression Tests

- `@agent-im-relay/core` tests remain green
- Discord package behavior remains unchanged
- Feishu package builds without callback-server artifacts

## Acceptance Criteria

- `packages/feishu` starts without opening a local TCP listener
- Feishu message events are received through long connection
- Feishu card-action events are handled through long connection
- New Feishu conversations still require backend selection before first run
- Session control cards still work
- File ingestion and artifact return still work
- Managed gateway / callback-specific code paths are removed from the Feishu package
