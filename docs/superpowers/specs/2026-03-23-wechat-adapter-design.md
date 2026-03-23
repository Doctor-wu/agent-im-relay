# WeChat Adapter Design

**Date:** 2026-03-23

**Goal:** Add a first-party WeChat (微信) platform package that plugs into the existing core adapter interfaces, uses the official Tencent iLink Bot API for message transport, and provides DM-based agent conversations with media support and text-based interactive selection.

## Background

Tencent has officially released the iLink Bot API for WeChat, enabling third-party bot integrations via QR code login and long-poll message transport. WeChat 8.0.70+ with the ClawBot plugin enabled is required. The official OpenClaw community plugin (`@tencent-weixin/openclaw-weixin` v1.0.2) validates that the API is functional, though it has known limitations (no proactive messaging, message ordering issues, no thinking/reasoning filtering).

This design builds an independent, self-controlled WeChat adapter within agent-im-relay rather than depending on the OpenClaw plugin ecosystem.

## Scope

This design covers:

- A new `packages/wechat` package for WeChat bot runtime and adapter code
- `PlatformAdapter` support for WeChat message sending, conversation management, and media handling
- iLink Bot API client: QR code authentication, long-poll message reception, heartbeat keepalive
- DM-only conversation model with contextToken-based reply mechanism
- Media send/receive (images, files, ≤100MB)
- Text-based interactive selection (`TextInteractionStrategy`) for backend/model choosing
- Segmented output strategy for long responses (WeChat does not support message editing)
- Multi-account support
- Typing indicators
- Core registration updates for `wechat` as a supported relay platform

Out of scope:

- Group chat support (iLink Bot API currently DM-only)
- Proactive/unsolicited messaging (blocked by contextToken requirement)
- Message editing or recall
- Rich interactive components (WeChat has no equivalent to Discord buttons or Slack Block Kit)
- Enterprise WeChat (WeCom) — separate API, separate adapter if needed later
- Wechaty or other unofficial protocol integrations

## Product Constraints

- WeChat 8.0.70+ is required with the ClawBot plugin enabled (Tencent is rolling this out gradually)
- All conversations are DM-only; the bot cannot initiate conversations
- The bot can only reply within an active session that has a valid contextToken
- WeChat does not support editing sent messages, so streaming must use segmented delivery
- No rich UI components — all interactive flows use numbered text selection
- Media size limit is 100MB per the iLink Bot API

## Recommended Approach

Use a dedicated `packages/wechat` package implementing the existing `PlatformAdapter` interface, with the iLink Bot API protocol details fully encapsulated in an internal client module. Interactive selection uses a new `TextInteractionStrategy` that presents numbered options and parses digit replies — designed to be reusable by other text-only platforms (e.g., Feishu) once validated.

This approach keeps WeChat transport concerns isolated while maximizing reuse of shared relay logic (backend/model selection flow, conversation management, streaming orchestration).

## Architecture

### Package layout

```
packages/wechat/
├── src/
│   ├── index.ts              # Package entry point and runtime bootstrap
│   ├── config.ts             # WeChat environment and runtime configuration
│   ├── adapter.ts            # WeChatAdapter implements PlatformAdapter
│   ├── ilink-client.ts       # iLink Bot API client (connect, auth, long-poll, heartbeat)
│   ├── qr-auth.ts            # QR code login flow management
│   ├── message-handler.ts    # Inbound WeChat message → RelayMessage conversion
│   ├── message-sender.ts     # RelayMessage → WeChat outbound (contextToken management)
│   ├── media.ts              # Media upload/download (images, files, ≤100MB)
│   ├── interaction.ts        # TextInteractionStrategy — numbered selection
│   ├── streaming.ts          # Segmented output: buffer → timed/sized flush
│   ├── types.ts              # WeChat-specific type definitions
│   └── __tests__/            # Package-level unit tests
├── package.json
└── tsconfig.json
```

Core changes stay limited to registration and platform inference:

- `packages/core/src/relay-platform.ts` — add `'wechat'` to supported platforms
- `packages/core/src/paths.ts` — add WeChat state persistence paths

### Adapter responsibilities

WeChat implements the following capabilities from `PlatformAdapter`:

- **MessageSender**: send text and media messages via iLink Bot API, using cached contextToken for reply routing
- **ConversationManager**: map WeChat DM sessions to relay conversations; each user DM is one conversation
- **StatusIndicator**: send typing indicators via iLink Bot API during processing
- **InteractiveUI**: `TextInteractionStrategy` — post numbered option lists, parse digit replies, handle timeout and invalid input
- **MarkdownFormatter**: convert Markdown output to WeChat-compatible plain text (strip unsupported syntax, preserve code blocks and links)

## Connection and Authentication

### QR code login

1. On startup, `ilink-client` calls iLink Bot API to request a QR code
2. QR code is displayed in the CLI terminal (consistent with existing platform onboarding)
3. User scans with WeChat 8.0.70+ to authorize
4. Session token is received and persisted to `config.jsonl` (alongside Discord/Slack tokens)
5. Subsequent startups attempt automatic reconnection with cached token; expired tokens trigger fresh QR flow

### Long-poll message reception

- After successful login, establish long-poll connection for continuous message monitoring
- Automatic reconnection on disconnect with exponential backoff (1s → 2s → 4s → 8s → 16s → 30s cap)
- Heartbeat keepalive to prevent silent connection drops
- Each received message includes a contextToken cached for reply use

### contextToken management

- On every inbound message, cache the contextToken (in-memory + persisted to disk)
- Outbound messages retrieve contextToken from cache
- Cache miss → message cannot be sent; log warning, do not crash
- This is the root cause of the v1 proactive messaging limitation; when the API evolves, only this layer changes

### Multi-account

- Each WeChat account runs its own `ilink-client` instance
- Account configuration lives under `wechat.accounts[]` in `config.jsonl`
- Aligned with existing multi-bot (Discord) / multi-workspace (Slack) patterns

## Message Processing

### Inbound flow

1. Long-poll receives WeChat message
2. `message-handler.ts` converts to unified `RelayMessage` format
3. Media attachments: download from iLink API → store as temp file → attach to `RelayMessage.attachments`
4. Pass to relay core for processing

### Outbound flow

1. Relay core produces response
2. `message-sender.ts` converts `RelayMessage` to WeChat format
3. Text: send directly via iLink API with contextToken
4. Media: `media.ts` uploads attachment to iLink API → send media message
5. Long text: `streaming.ts` handles segmented delivery

### Media handling

- **Receive**: download from iLink API → temp file → `RelayMessage.attachments`
- **Send**: relay attachment → upload to iLink API → send media message
- **Size limit**: ≤100MB; oversized files return a friendly error message to the user
- **Supported types**: images (jpg/png/gif), files (any type within size limit)

## Interactive Selection (TextInteractionStrategy)

For backend/model selection and other interactive flows where Discord uses buttons and Slack uses Block Kit:

```
Bot: 请选择 Backend：
1. Codex
2. Claude Code
3. OpenCode
回复数字选择，10秒后自动选择 1

User: 2

Bot: ✅ 已选择 Claude Code
```

### State machine

- **Idle** → user triggers selection (e.g., new conversation starts)
- **Waiting** → bot sends numbered list, enters waiting state
  - Valid digit reply → select option, transition to **Idle**, confirm selection
  - Invalid input → prompt retry, stay in **Waiting** (max 3 retries)
  - Timeout (default 10s, reuses existing config) → auto-select default, transition to **Idle**
  - Max retries exceeded → fallback to default, transition to **Idle**
- During **Waiting** state, digit replies are intercepted by the interaction layer and do not reach the agent

### Reusability

`TextInteractionStrategy` is implemented in `packages/wechat` for v1. Once validated, it can be extracted to shared core for reuse by other text-only platforms (e.g., Feishu Markdown card limitations).

## Streaming / Segmented Output

WeChat does not support editing sent messages, so real-time streaming (like Discord's progressive message updates) is not possible.

### Strategy

- Buffer agent output
- Flush when either threshold is met:
  - **Size**: 500 characters accumulated
  - **Time**: 3 seconds since last flush
- Final segment is marked with `[完成]` suffix
- User experience: "segmented replies" rather than true streaming

### Configuration

- v1: thresholds are hardcoded (500 chars / 3s)
- Future: make configurable per-account for different user preferences

## Error Handling

### Connection layer
- Long-poll disconnect → exponential backoff reconnection (1s/2s/4s/8s/16s/30s cap)
- QR code expired → re-request and prompt user to scan again

### Authentication layer
- Session token invalid/expired → clear cached token, restart QR login flow
- contextToken expired → mark session as non-replyable, wait for user's next message to refresh

### Message layer
- Send failure → retry 2 times (1s interval); still failing → log error + notify relay core
- Media upload failure → degrade to plain text message: "媒体发送失败，请重试"

### Interaction layer
- Selection timeout / max retries → fallback to default (covered in TextInteractionStrategy state machine)

## Testing Strategy

### Unit tests
- `ilink-client`: mock API responses for connection, reconnection, heartbeat, auth flows
- `message-handler`: test conversion of all WeChat message types to `RelayMessage` format
- `message-sender`: test contextToken lookup, cache miss handling, retry logic
- `media`: test upload/download flows, size limit enforcement, error degradation
- `interaction`: test `TextInteractionStrategy` state machine — valid selection, invalid input, timeout, max retries, fallback
- `streaming`: test buffer flush by size threshold, time threshold, final segment marking

### Integration tests
- Mock iLink Bot API server
- Test full flow: QR login → receive message → process → reply
- Test media round-trip: receive image → process → reply with image
- Test interactive selection end-to-end

### Manual acceptance
- Real WeChat account QR code login
- Send text messages, verify agent response
- Send images and files, verify media handling
- Verify backend/model selection via numbered replies
- Verify segmented output for long responses
- Verify reconnection after network interruption

## Known Limitations (v1)

- **No proactive messaging**: bot cannot initiate conversations (contextToken dependency)
- **DM only**: no group chat support
- **No message editing/recall**: WeChat API limitation
- **Requires WeChat 8.0.70+**: ClawBot plugin must be enabled and available (gradual rollout)
- **No rich UI components**: all interaction via plain text numbered selection

## Delivery Plan

Implementation should happen in an isolated git branch. Package-focused verification as each module lands. The implementation order should follow dependency chains:

1. `types.ts` + `config.ts` — type definitions and configuration schema
2. `ilink-client.ts` + `qr-auth.ts` — connection and authentication
3. `message-handler.ts` + `message-sender.ts` — message conversion
4. `media.ts` — media upload/download
5. `interaction.ts` — TextInteractionStrategy
6. `streaming.ts` — segmented output
7. `adapter.ts` + `index.ts` — PlatformAdapter integration and bootstrap
8. Core registration (`relay-platform.ts`, `paths.ts`)
9. Integration tests + manual acceptance
