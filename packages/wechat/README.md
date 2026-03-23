# @agent-im-relay/wechat

WeChat adapter for Agent Inbox, powered by [iLink](https://ilink.bot) WebSocket bridge.

## Features

- Long-connection via iLink WebSocket with automatic reconnect and heartbeat
- QR code authentication flow
- Streaming message output with configurable thresholds
- Text-based interactive selection menus (WeChat has no native UI components)
- Markdown-to-plain-text formatting
- Media upload/download with domain allowlist security
- Message auto-segmentation for texts exceeding WeChat's 2000-character limit
- Retry with backoff on send failures

## Configuration

All configuration is managed through `~/.agent-inbox/config.jsonl`:

```jsonc
{
  "type": "im",
  "id": "wechat",
  "enabled": true,
  "config": {
    "name": "wechat",
    "sessionToken": "your-ilink-session-token",
    "reconnectMaxDelayMs": 30000,
    "heartbeatIntervalMs": 30000,
    "streamingCharThreshold": 500,
    "streamingTimeThresholdMs": 3000,
    "selectionTimeoutMs": 10000
  }
}
```

### Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | (required) | Adapter display name |
| `sessionToken` | `string` | — | iLink session token for API authentication |
| `reconnectMaxDelayMs` | `number` | `30000` | Max delay between WebSocket reconnect attempts |
| `heartbeatIntervalMs` | `number` | `30000` | Interval for WebSocket heartbeat pings |
| `streamingCharThreshold` | `number` | `500` | Character count threshold to trigger a streaming flush |
| `streamingTimeThresholdMs` | `number` | `3000` | Time threshold (ms) to trigger a streaming flush |
| `selectionTimeoutMs` | `number` | `10000` | Timeout for text-based selection menus |

### Environment Variables

When launched via `startSelectedIm()` in the CLI app, config values are passed through environment variables:

| Variable | Maps to |
|----------|---------|
| `WECHAT_NAME` | `name` |
| `WECHAT_SESSION_TOKEN` | `sessionToken` |
| `WECHAT_RECONNECT_MAX_DELAY_MS` | `reconnectMaxDelayMs` |
| `WECHAT_HEARTBEAT_INTERVAL_MS` | `heartbeatIntervalMs` |
| `WECHAT_STREAMING_CHAR_THRESHOLD` | `streamingCharThreshold` |
| `WECHAT_STREAMING_TIME_THRESHOLD_MS` | `streamingTimeThresholdMs` |
| `WECHAT_SELECTION_TIMEOUT_MS` | `selectionTimeoutMs` |

## Usage

### As part of Agent Inbox (recommended)

Select WeChat in the interactive setup wizard:

```bash
agent-inbox
```

### Programmatic

```typescript
import { WeChatAdapter, parseWeChatConfig } from '@agent-im-relay/wechat';

const config = parseWeChatConfig({
  name: 'my-wechat',
  sessionToken: 'tok_xxx',
});

const adapter = new WeChatAdapter(config, globalThis.fetch.bind(globalThis));

adapter.onStatusChange((status) => console.log('status:', status));
adapter.onMessage((msg) => console.log('message:', msg.content));

await adapter.start();
```

## Architecture

```text
adapter.ts          PlatformAdapter implementation, event routing
ilink-client.ts     WebSocket client with reconnect/heartbeat
message-sender.ts   Send messages via iLink REST API (Bearer auth)
message-handler.ts  Incoming message conversion, contextToken cache (LRU, 10k cap)
streaming.ts        Batched streaming output with char/time thresholds
interaction.ts      Text-based selection menus (no native WeChat UI)
media.ts            Upload/download media with domain allowlist
qr-auth.ts          QR code login flow
config.ts           Config parsing and defaults
types.ts            Shared types and constants
```

## License

MIT
