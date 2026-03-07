# Feishu Managed Gateway Design

**Date:** 2026-03-07

## Goal

Replace the current "Feishu callbacks hit the user's local machine" model with a managed gateway operated by us, while keeping interactive card workflows intact and reducing end-user setup to running a local relay client with an outbound connection.

## Why This Change

The existing Feishu adapter assumes the user's machine exposes a callback URL. That conflicts with the intended product experience:

- users should not need a public IP, reverse tunnel, or TLS setup
- interactive cards must remain available
- setup should be closer to "install client, connect, start chatting"

Pure long-connection ingestion on the local machine removes callback setup, but it does not fit the current card-action model cleanly enough. A managed gateway lets us keep callbacks and cards without pushing network complexity to users.

## Architecture

### Components

1. `gateway service`
- hosted by us
- receives Feishu callbacks for message events and card actions
- validates signatures and verification challenges
- routes normalized requests to the correct local relay client
- sends message, card, and file responses back to Feishu

2. `relay client`
- runs on the user's machine
- holds local execution context such as working directory, state file, and backend binaries
- maintains an outbound bridge connection to the gateway
- executes conversation runs through the shared core orchestration layer

3. `core orchestration`
- remains platform-agnostic
- keeps shared conversation control semantics, attachment handling, and artifact staging
- does not know about Feishu callbacks or gateway connectivity details

### Boundary Decisions

- Feishu API credentials live on the gateway side in the managed mode
- local client never needs a public listener
- card-session state lives primarily on the gateway side so callbacks remain valid even if the client reconnects
- local execution state remains local: working directory, session files, artifact files, backend binaries
- this MVP does not add a full multi-tenant account system; it assumes a simple device/client token model

## Data Flow

### Message Event

1. User sends a Feishu message or mentions the bot in a group.
2. Feishu posts the event to the managed gateway callback.
3. Gateway validates the request and normalizes it into a platform-neutral request.
4. Gateway resolves the target local client from the conversation binding.
5. Gateway forwards a bridge command to the connected relay client.
6. Relay client executes the run via shared core orchestration.
7. Relay client streams status and final outputs back to gateway.
8. Gateway sends text, cards, and files to Feishu.

### Card Action

1. User clicks a card button in Feishu.
2. Feishu posts the action callback to gateway.
3. Gateway validates it and resolves the associated conversation.
4. Gateway either applies the control action directly or forwards a follow-up run command to the client.
5. Gateway updates the visible Feishu UI and sends any follow-up messages.

### File Flow

1. Gateway receives a file event reference from Feishu.
2. Gateway downloads the file with Feishu API credentials.
3. Gateway passes file bytes or a staged payload to the local client.
4. Local client stores the file in the existing attachment workflow.
5. Artifacts produced by the run are uploaded from client to gateway.
6. Gateway uploads them to Feishu and posts file messages.

## State Placement

### Gateway-owned state

- callback dedupe keys
- client presence and heartbeat state
- conversation-to-client routing
- pending card action context
- message/action correlation ids
- optional staged inbound file metadata

### Client-owned state

- conversation continuation sessions
- backend/model/effort preferences that are already persisted locally
- local attachment staging
- artifact files on disk
- working directory and tool execution environment

## Bridge Protocol

The first version should use a narrow protocol instead of a generic event bus.

### Gateway to Client

- `conversation.run`
- `conversation.control`
- `conversation.file`
- `client.ack`

### Client to Gateway

- `client.hello`
- `client.heartbeat`
- `conversation.text`
- `conversation.card`
- `conversation.file`
- `conversation.error`
- `conversation.done`

Each message includes:

- `clientId`
- `conversationId`
- `requestId`
- `timestamp`
- typed payload

This keeps the transport generic enough for other IM platforms later, without prematurely building a large broker framework.

## Authentication

The MVP uses a simple managed client token:

- gateway issues a client token out of band
- local relay client connects with that token
- gateway binds the connection to a `clientId`

This is enough to validate the architecture. Device enrollment UX, token rotation UI, and richer org/account modeling are intentionally deferred.

## Error Handling

- if no client is connected for the target route, gateway replies in Feishu with a clear "relay offline" message
- if the client disconnects mid-run, gateway marks the request failed and updates the user-visible thread
- if Feishu API calls fail, gateway logs the failure and surfaces a short error message to the user
- duplicate callbacks remain suppressed at the gateway boundary
- invalid or expired card context returns a clear "conversation expired" response

## Testing Strategy

### Core

- keep existing platform conversation tests green
- add bridge-protocol helpers only where they are truly shared

### Feishu Gateway

- callback handler routes message events to the bridge
- callback handler routes card actions to the bridge
- offline client path returns a user-visible failure
- gateway response sink sends text/card/file payloads through the Feishu API client

### Relay Client

- client handshake and heartbeat
- handling of `conversation.run` and `conversation.control`
- streaming of text/error/done back to gateway transport
- artifact upload path

## MVP Scope

Included:

- managed Feishu callback ingress
- local relay client outbound bridge connection
- text messages
- backend selection and control cards
- artifact/file upload from local client back to Feishu
- explicit offline messaging

Excluded:

- full user account system
- browser admin UI
- multi-device conflict resolution beyond "last active client wins"
- encrypted Feishu callback payloads
- migration of Discord to the managed gateway path

## Repository Shape

The code should stay incremental:

- keep shared orchestration in `packages/core`
- evolve `packages/feishu` into the managed gateway package
- add a small bridge module to `packages/core` for shared protocol types if needed
- add a local managed client entrypoint in `packages/feishu` instead of creating a new package immediately

This keeps the first implementation small enough to validate, while leaving room to split the gateway/client transport into a dedicated package later if the protocol stabilizes.
