# WeChat Adapter Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-party WeChat platform package using the iLink Bot API with QR code auth, long-poll messaging, media support, text-based interactive selection, and segmented output.

**Architecture:** Build a dedicated `packages/wechat` package implementing `PlatformAdapter`. The iLink Bot API protocol is fully encapsulated in `ilink-client.ts`. Interactive selection uses a `TextInteractionStrategy` (numbered options + digit replies). Streaming uses segmented delivery (buffer by size/time, flush as separate messages). Core changes limited to platform registration.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, iLink Bot API (HTTP + long-poll), existing `@agent-im-relay/core`

---

## Chunk 1: Core WeChat platform plumbing

### Task 1: Register WeChat as a relay platform in core

**Files:**
- Modify: `packages/core/src/relay-platform.ts`
- Modify: `packages/core/src/paths.ts`
- Modify or create: `packages/core/src/__tests__/relay-platform.test.ts`

- [ ] **Step 1: Write the failing core tests**

Add tests that prove:
- `relayPlatforms` includes `'wechat'`
- WeChat conversation ids are inferable without colliding with Discord/Slack/Feishu ids
- WeChat-scoped state paths resolve correctly under the relay state directory

- [ ] **Step 2: Run the targeted core tests to verify they fail**

Run: `pnpm vitest run packages/core/src/__tests__/relay-platform.test.ts`
Expected: FAIL because `'wechat'` is not a known relay platform.

- [ ] **Step 3: Write the minimal core implementation**

- Add `'wechat'` to `relayPlatforms` array
- Teach `inferRelayPlatformFromConversationId()` to recognize WeChat conversation id format (prefix `wechat:`)
- Add WeChat-specific path helpers for state persistence

- [ ] **Step 4: Run the targeted core tests to verify they pass**

Run: `pnpm vitest run packages/core/src/__tests__/relay-platform.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/relay-platform.ts packages/core/src/paths.ts packages/core/src/__tests__/relay-platform.test.ts
git commit -m "feat(core): register wechat relay platform"
```

---

## Chunk 2: Scaffold WeChat package with types and config

### Task 2: Create package structure, types, and config parsing

**Files:**
- Create: `packages/wechat/package.json`
- Create: `packages/wechat/tsconfig.json`
- Create: `packages/wechat/tsdown.config.ts`
- Create: `packages/wechat/vitest.config.ts`
- Create: `packages/wechat/src/index.ts`
- Create: `packages/wechat/src/types.ts`
- Create: `packages/wechat/src/config.ts`
- Create: `packages/wechat/src/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing config tests**

Cover these behaviors:
- Config parsing for WeChat account entries from `config.jsonl` (`wechat.accounts[]`)
- Each account has: `name`, `sessionToken` (optional, persisted after QR login)
- Default values for reconnect backoff (maxDelay: 30s), heartbeat interval, streaming thresholds (500 chars / 3s)
- Config validation rejects missing required fields

- [ ] **Step 2: Run the config tests to verify they fail**

Run: `pnpm vitest run packages/wechat/src/__tests__/config.test.ts`
Expected: FAIL because `packages/wechat` does not exist yet.

- [ ] **Step 3: Write the minimal package and config implementation**

Create the new package using the same build/test conventions as `packages/discord` and `packages/slack`:
- `package.json` with workspace dependency on `@agent-im-relay/core`
- `types.ts` with WeChat-specific types: `WeChatMessage`, `WeChatMediaAttachment`, `WeChatAccount`, `ILinkAuthState`, `ContextTokenCache`
- `config.ts` with config parsing, validation, and defaults

- [ ] **Step 4: Run the config tests to verify they pass**

Run: `pnpm vitest run packages/wechat/src/__tests__/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/wechat/
git commit -m "feat(wechat): scaffold package with types and config"
```

---

## Chunk 3: iLink Bot API client — connection and authentication

### Task 3: Implement iLink client with QR auth and long-poll

**Files:**
- Create: `packages/wechat/src/ilink-client.ts`
- Create: `packages/wechat/src/qr-auth.ts`
- Create: `packages/wechat/src/__tests__/ilink-client.test.ts`
- Create: `packages/wechat/src/__tests__/qr-auth.test.ts`

- [ ] **Step 1: Write the failing ilink-client tests**

Cover these behaviors:
- `connect()` initiates QR auth flow when no cached session token
- `connect()` uses cached session token for reconnection when available
- Long-poll loop receives messages and emits them via callback
- Exponential backoff on disconnect: 1s → 2s → 4s → 8s → 16s → 30s cap
- Backoff resets after successful reconnection
- Heartbeat sends keepalive at configured interval
- `disconnect()` cleanly stops long-poll and heartbeat

- [ ] **Step 2: Write the failing qr-auth tests**

Cover these behaviors:
- `requestQRCode()` calls iLink API and returns QR code data
- `waitForScan()` polls until user scans or timeout
- QR code expiry triggers re-request
- Successful scan returns session token
- Session token is persisted to config

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run packages/wechat/src/__tests__/ilink-client.test.ts packages/wechat/src/__tests__/qr-auth.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement ilink-client and qr-auth**

- `ilink-client.ts`: HTTP client for iLink Bot API, long-poll loop with reconnection, heartbeat timer, event emitter for incoming messages
- `qr-auth.ts`: QR code request, scan polling, token persistence
- All iLink API calls go through a shared HTTP helper with error handling
- Mock the actual HTTP calls in tests using Vitest mocks

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/wechat/src/__tests__/ilink-client.test.ts packages/wechat/src/__tests__/qr-auth.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/wechat/src/ilink-client.ts packages/wechat/src/qr-auth.ts packages/wechat/src/__tests__/ilink-client.test.ts packages/wechat/src/__tests__/qr-auth.test.ts
git commit -m "feat(wechat): iLink Bot API client with QR auth and long-poll"
```

---

## Chunk 4: Message handling — inbound and outbound conversion

### Task 4: Implement message handler and sender with contextToken management

**Files:**
- Create: `packages/wechat/src/message-handler.ts`
- Create: `packages/wechat/src/message-sender.ts`
- Create: `packages/wechat/src/__tests__/message-handler.test.ts`
- Create: `packages/wechat/src/__tests__/message-sender.test.ts`

- [ ] **Step 1: Write the failing message-handler tests**

Cover these behaviors:
- Text message → `RelayMessage` with correct fields (sender, content, conversationId, timestamp)
- Image message → `RelayMessage` with attachment (type, url, temp file path)
- File message → `RelayMessage` with attachment
- Unknown message type → logged and skipped, no crash
- contextToken extracted and cached on every inbound message

- [ ] **Step 2: Write the failing message-sender tests**

Cover these behaviors:
- `RelayMessage` text → iLink API send call with correct contextToken
- contextToken cache hit → message sent successfully
- contextToken cache miss → message not sent, warning logged, no crash
- Long text (>WeChat limit) → auto-segmented before sending
- Send failure → retry 2 times (1s interval), then log error

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run packages/wechat/src/__tests__/message-handler.test.ts packages/wechat/src/__tests__/message-sender.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement message-handler and message-sender**

- `message-handler.ts`: parse iLink message payloads, convert to `RelayMessage`, extract and cache contextToken (in-memory Map + persist to disk)
- `message-sender.ts`: convert `RelayMessage` to iLink send payload, lookup contextToken, retry logic, error handling
- Markdown → WeChat plain text conversion: strip unsupported syntax, preserve code blocks and links

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/wechat/src/__tests__/message-handler.test.ts packages/wechat/src/__tests__/message-sender.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/wechat/src/message-handler.ts packages/wechat/src/message-sender.ts packages/wechat/src/__tests__/message-handler.test.ts packages/wechat/src/__tests__/message-sender.test.ts
git commit -m "feat(wechat): message handler and sender with contextToken management"
```

---

## Chunk 5: Media upload/download

### Task 5: Implement media handling

**Files:**
- Create: `packages/wechat/src/media.ts`
- Create: `packages/wechat/src/__tests__/media.test.ts`

- [ ] **Step 1: Write the failing media tests**

Cover these behaviors:
- `downloadMedia(url)` fetches from iLink API → saves to temp file → returns local path
- `uploadMedia(filePath)` reads file → uploads to iLink API → returns media id
- File size check: >100MB → reject with friendly error message
- Supported types: images (jpg/png/gif), files (any type within size limit)
- Download failure → return error, no crash
- Upload failure → return error message "媒体发送失败，请重试"

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/wechat/src/__tests__/media.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement media module**

- `media.ts`: download helper (iLink API → temp file), upload helper (file → iLink API), size validation, error handling with degradation to text

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/wechat/src/__tests__/media.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/wechat/src/media.ts packages/wechat/src/__tests__/media.test.ts
git commit -m "feat(wechat): media upload and download with size validation"
```

---

## Chunk 6: Text-based interactive selection

### Task 6: Implement TextInteractionStrategy

**Files:**
- Create: `packages/wechat/src/interaction.ts`
- Create: `packages/wechat/src/__tests__/interaction.test.ts`

- [ ] **Step 1: Write the failing interaction tests**

Cover the full state machine:
- **Idle → Waiting**: `startSelection(options)` sends numbered list, enters waiting state
- **Waiting + valid digit**: selects option, sends confirmation, returns to Idle
- **Waiting + invalid input**: sends retry prompt, stays in Waiting (up to 3 retries)
- **Waiting + max retries exceeded**: fallback to default, returns to Idle
- **Waiting + timeout (10s)**: auto-select default, returns to Idle
- During Waiting state, digit replies are intercepted (not forwarded to agent)
- Non-digit messages during Waiting are forwarded to agent normally

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/wechat/src/__tests__/interaction.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement TextInteractionStrategy**

- `interaction.ts`: state machine with Idle/Waiting states, numbered list formatter, digit parser, timeout timer, retry counter, default fallback
- Timeout duration reads from config (default 10s)
- Output messages: numbered list, confirmation ("✅ 已选择 X"), retry prompt, timeout notice

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/wechat/src/__tests__/interaction.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/wechat/src/interaction.ts packages/wechat/src/__tests__/interaction.test.ts
git commit -m "feat(wechat): TextInteractionStrategy with numbered selection state machine"
```

---

## Chunk 7: Segmented streaming output

### Task 7: Implement segmented output strategy

**Files:**
- Create: `packages/wechat/src/streaming.ts`
- Create: `packages/wechat/src/__tests__/streaming.test.ts`

- [ ] **Step 1: Write the failing streaming tests**

Cover these behaviors:
- Buffer accumulates text chunks
- Flush triggers when buffer reaches 500 characters
- Flush triggers when 3 seconds elapse since last flush
- Final flush appends `[完成]` suffix
- Multiple flushes produce separate messages in order
- Empty buffer does not trigger flush
- `cancel()` clears buffer and timers

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/wechat/src/__tests__/streaming.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement streaming module**

- `streaming.ts`: `SegmentedOutput` class with `append(text)`, `flush()`, `finish()`, `cancel()` methods
- Internal buffer, size threshold (500 chars), time threshold (3s timer), flush callback
- `finish()` flushes remaining buffer with `[完成]` suffix

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/wechat/src/__tests__/streaming.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/wechat/src/streaming.ts packages/wechat/src/__tests__/streaming.test.ts
git commit -m "feat(wechat): segmented streaming output with size and time thresholds"
```

---

## Chunk 8: PlatformAdapter integration and bootstrap

### Task 8: Wire everything together in WeChatAdapter

**Files:**
- Create: `packages/wechat/src/adapter.ts`
- Modify: `packages/wechat/src/index.ts`
- Create: `packages/wechat/src/__tests__/adapter.test.ts`

- [ ] **Step 1: Write the failing adapter tests**

Cover these behaviors:
- `WeChatAdapter` implements `PlatformAdapter` interface
- `start()` initiates iLink client connection (QR auth or token reconnect)
- `stop()` disconnects cleanly
- Inbound message from iLink client → converted → forwarded to relay core
- Outbound message from relay core → converted → sent via iLink client
- Media messages handled correctly in both directions
- Backend/model selection triggers `TextInteractionStrategy`
- Long responses use `SegmentedOutput`
- Typing indicators sent during processing
- Multi-account: each account gets its own adapter instance

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/wechat/src/__tests__/adapter.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement WeChatAdapter**

- `adapter.ts`: `WeChatAdapter` class implementing `PlatformAdapter`
  - Constructor takes config, creates `ILinkClient`, `MessageHandler`, `MessageSender`, `MediaHandler`, `TextInteractionStrategy`, `SegmentedOutput`
  - `start()`: connect iLink client, register message listener
  - `stop()`: disconnect iLink client
  - Message routing: inbound → handler → relay core; outbound → sender → iLink
  - Typing indicators via iLink API
- `index.ts`: export `WeChatAdapter`, register with relay platform bootstrap

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/wechat/src/__tests__/adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/wechat/src/adapter.ts packages/wechat/src/index.ts packages/wechat/src/__tests__/adapter.test.ts
git commit -m "feat(wechat): WeChatAdapter implementing PlatformAdapter"
```

---

## Chunk 9: Integration tests and documentation

### Task 9: End-to-end integration tests with mock iLink server

**Files:**
- Create: `packages/wechat/src/__tests__/integration.test.ts`
- Modify: project root `README.md` (add WeChat to supported platforms)

- [ ] **Step 1: Write integration tests**

Cover full flows with a mock iLink Bot API server:
- QR login → receive text message → process → reply
- Receive image → process → reply with text
- Send image attachment → upload → deliver
- Backend selection via numbered reply → agent conversation starts
- Long response → segmented delivery (multiple messages + [完成])
- Connection drop → reconnect → resume receiving

- [ ] **Step 2: Run integration tests**

Run: `pnpm vitest run packages/wechat/src/__tests__/integration.test.ts`
Expected: PASS (all flows work end-to-end with mock server)

- [ ] **Step 3: Update project documentation**

- Add WeChat to supported platforms list in root `README.md`
- Document WeChat-specific config fields in config reference
- Note known limitations (DM only, no proactive messaging, WeChat 8.0.70+ required)

- [ ] **Step 4: Run full test suite to verify no regressions**

Run: `pnpm vitest run`
Expected: All existing tests PASS, all new WeChat tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/wechat/src/__tests__/integration.test.ts README.md
git commit -m "feat(wechat): integration tests and documentation"
```

---

## Manual Acceptance Checklist

After all chunks are implemented and tests pass:

- [ ] Real WeChat account QR code login via CLI
- [ ] Send text message to bot, receive agent response
- [ ] Send image to bot, verify media handling
- [ ] Send file to bot, verify attachment processing
- [ ] Verify backend/model selection via numbered replies
- [ ] Verify segmented output for long agent responses
- [ ] Verify typing indicators during processing
- [ ] Kill network connection, verify automatic reconnection
- [ ] Restart application, verify token-based auto-reconnect (no QR needed)
- [ ] Test with multiple WeChat accounts configured
