# Agent Inbox

> Let local AI agents such as Claude Code and Codex receive tasks and reply with results directly inside Discord, Feishu, Slack, WeChat, and other IM platforms, without any server. Everything runs on your own machine.

[![npm version](https://img.shields.io/npm/v/@doctorwu/agent-inbox)](https://www.npmjs.com/package/@doctorwu/agent-inbox)
[![GitHub release](https://img.shields.io/github/v/release/Doctor-wu/agent-im-relay)](https://github.com/Doctor-wu/agent-im-relay/releases)
![Node >=20](https://img.shields.io/badge/node-%3E%3D20-339933)
![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6)
[![Discord](https://img.shields.io/badge/platform-Discord-5865F2)](https://discord.com)
[![Feishu](https://img.shields.io/badge/platform-Feishu-00B96B)](https://open.feishu.cn)
[![Slack](https://img.shields.io/badge/platform-Slack-4A154B)](https://slack.com)
[![WeChat](https://img.shields.io/badge/platform-WeChat-07C160)](https://ilink.bot)

---

## Why Agent Inbox

- **Inbox-first workflow** - Send a message to the bot in your IM app, let the agent open a session automatically, execute the task, and send the result back with file upload and download support.
- **Multiple IM platforms** - Discord, Feishu, Slack, and WeChat are supported today, and the architecture is designed to extend cleanly to additional platforms.
- **Multiple agent backends** - Switch between Claude Code and OpenAI Codex depending on the task.
- **Runs locally with full data control** - Configuration and runtime state live in `~/.agent-inbox/`, with no cloud deployment required.
- **Persistent sessions** - Keep context across messages, interrupt and resume work, and isolate each session in its own working directory.
- **Safe-mode approvals in IM** - When enabled, dangerous backend actions are surfaced as approval cards/buttons in your chat.

---

## Quick Start

### Step 1: Install

```bash
npm install -g @doctorwu/agent-inbox
# Or run it directly without a global install
npx @doctorwu/agent-inbox
```

### Step 2: Configure

On first launch, Agent Inbox starts an interactive setup wizard that walks you through IM platform configuration. Backend/model selection is done per conversation through platform controls.

Configuration is stored in `~/.agent-inbox/config.jsonl`. Example:

```jsonc
{"type":"meta","version":1}
{"type":"im","id":"discord","enabled":true,"config":{"token":"your-bot-token","clientId":"your-client-id"}}
{"type":"im","id":"feishu","enabled":false,"config":{"appId":"","appSecret":""}}
{"type":"im","id":"wechat","enabled":false,"config":{"name":"wechat","sessionToken":""}}
{"type":"im","id":"slack","enabled":false,"config":{"botToken":"","appToken":"","signingSecret":"","socketMode":true}}
{"type":"runtime","config":{"agentTimeoutMs":600000,"permissionMode":"auto","permissionRequestTimeoutMs":120000,"claudeBin":"claude","codexBin":"codex","opencodeBin":"opencode"}}
```

Standalone adapter runs use the same `~/.agent-inbox/config.jsonl` file. There is no repo-local `.env` bootstrap path.

### Step 3: Start

```bash
agent-inbox
```

After startup, send a message to your configured bot to begin interacting with the agent.
Only one running instance is allowed per platform on the same machine.

---

## Supported IM Platforms

| Platform | Status | Notes |
|------|------|------|
| **Discord** ⭐ Recommended | ✅ Supported | Slash commands + mention-driven thread sessions, attachment ingest and artifact upload, streaming output |
| **Feishu (Lark)** | ✅ Supported | Long-connection mode, private-chat launcher, session/group chat continuation, interactive control cards |
| **Slack** | ✅ Supported | Slash commands + app mentions + DM/thread continuation, backend/model selection blocks, safe-mode approval blocks |
| **WeChat (微信)** | ✅ Supported | iLink WebSocket bridge, QR code auth, streaming output, text-based interactive menus |

## Platform Features

| Platform | How to start a run | Session controls | Files |
|------|------|------|------|
| **Discord** | `/code`, `/ask`, `/skill`, or `@mention` | `/interrupt`, `/done`, `/model`, `/effort`, `/sessions`, `/cwd`, `/compact`; backend/model selection cards on first run | Slash commands accept attachment options (up to 3) and mention messages ingest message attachments; outgoing artifacts are uploaded back |
| **Feishu** | Send a message in session/group chat, or use private chat launcher; `/ask <prompt>` for ask mode | Interactive cards for interrupt/backend/model/effort/done, plus backend switch confirmation | Message files are ingested and usable in run context; generated files can be uploaded back |
| **Slack** | `/code`, `/ask`, `/skill`, app mention, DM message, or thread reply | `/interrupt`, `/done`; backend/model picked via Block Kit buttons; safe-mode approval buttons | Text-first workflow (no built-in Slack file ingest/upload pipeline yet) |
| **WeChat** | Send a message to the linked WeChat account | Text-based selection menus for controls | Media upload/download via iLink API |

### Discord Setup

Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications) and obtain its `Token` and `Client ID`.

Discord is the recommended platform for the best interactive workflow. It supports:

- `/code <prompt>` — Start a coding task and automatically create a dedicated thread for the session
- `/ask <question>` — Ask a quick question without file tools
- `/skill <name> <prompt>` — Invoke a predefined skill directly
- `/model <name>` — Switch the active agent model
- `/effort <level>` — Set the agent effort level
- `/sessions` — List active sessions
- `/cwd set|show|clear` — Manage thread-level working directory override
- `/compact` — Ask the agent to summarize current thread context
- `/interrupt` — Interrupt the current task
- `/done` — End the current session
- `@mention` — Mention the bot in a channel to trigger a conversation there as well

### Feishu Setup

Create a self-built enterprise application in the [Feishu Open Platform](https://open.feishu.cn), enable long-connection event subscriptions, and obtain the `App ID` and `App Secret`.

### Slack Setup

Create a Slack app with slash commands and Socket Mode, then collect `botToken`, `appToken`, and `signingSecret`.

### WeChat Setup

WeChat integration uses the [iLink](https://ilink.bot) WebSocket bridge. You need an iLink session token to authenticate.

1. Obtain an iLink session token from the iLink platform.
2. Add the token to your `~/.agent-inbox/config.jsonl` as the `sessionToken` field in the WeChat config.
3. On first connect, the adapter performs QR code authentication — scan the QR code with your WeChat mobile app to link the account.

## Inline Backend Control Tag

In mention/message flows, you can switch backend inline by embedding:

```text
<set-backend>codex</set-backend>
Please continue this task.
```

The tag is removed before sending prompt text to the backend. If multiple valid tags are present, the last one wins.

---

## Supported Agent Backends

| Backend | Notes |
|---------|------|
| **Claude Code** | Anthropic Claude with streaming output and tool calling |
| **OpenAI Codex** | OpenAI Codex CLI with streaming output |
| **OpenCode** | Optional fallback backend with no known safe-mode approval protocol |

You can switch backend/model per conversation through platform controls (Discord commands/cards, Feishu cards, Slack buttons), and via inline `<set-backend>...</set-backend>` tags in message flows.

---

## Permission Mode

Permission approval behavior is configured in the `runtime` record inside `~/.agent-inbox/config.jsonl`.

### `permissionMode`

- `auto` - Backward-compatible default behavior. Agent backends run with their existing automation flags, so dangerous operations are handled automatically with no IM approval step.
- `safe` - Dangerous operations require an explicit approval from the IM client before the backend continues. Agent Inbox sends an approval card into the active conversation, waits for a user decision, then writes the backend's real approval protocol response back to stdin.

Safe mode currently requires backend CLIs with these capabilities:

- Codex must support `codex app-server --listen stdio://`
- Claude Code must support bidirectional `--input-format stream-json --output-format stream-json`
- OpenCode does not currently expose an equivalent approval protocol, so safe mode degrades to the backend's normal behavior or an unsupported-mode warning

### `permissionRequestTimeoutMs`

- Timeout in milliseconds for each pending permission request.
- Default: `120000` (2 minutes).
- Applies only when `permissionMode` is `safe`.

Example:

```jsonc
{"type":"runtime","config":{"permissionMode":"safe","permissionRequestTimeoutMs":120000}}
```

### Safe-Mode User Flow

1. The backend encounters a dangerous action and emits a permission request.
2. Agent Inbox renders an approval card in the active Discord thread, Feishu session chat, or Slack thread / DM.
3. A user clicks `Approve` or `Deny`.
4. Agent Inbox writes the backend-specific approval response back to stdin and the run continues.
5. If no one responds before timeout, the request is denied automatically and the backend continues by skipping that action.

### Platform Card Styles

- Discord - A thread message with `Permission required`, optional tool / reason text, and `Approve` / `Deny` buttons. After a decision, the message is updated with the final status.
- Feishu - An interactive card with a `Permission Required` header, tool / reason details, and `Approve` / `Deny` buttons. After resolution, the card shows the final status.
- Slack - A Block Kit card with a `Permission Required` summary, tool / reason section, and `Approve` / `Deny` buttons. After resolution, the same card is updated with the final status.

### Timeout Behavior

- Timeout defaults to `deny`.
- The backend keeps running after timeout and should skip the blocked operation instead of hanging indefinitely.
- The rendered card status changes to indicate that the request timed out and was denied.

---

## Runtime Configuration

All runtime knobs live in the `runtime` record inside `~/.agent-inbox/config.jsonl`.

| Key | Default | Description |
|------|------|------|
| `agentTimeoutMs` | `600000` | Max duration per agent run before timeout |
| `artifactRetentionDays` | `14` | Artifact retention window |
| `artifactMaxSizeBytes` | `8388608` | Max incoming/outgoing artifact size |
| `streamUpdateIntervalMs` | `1000` | Streaming flush interval for Discord/Slack |
| `discordMessageCharLimit` | `1900` | Per-message chunking limit on Discord |
| `permissionMode` | `auto` | `auto` or `safe` |
| `permissionRequestTimeoutMs` | `120000` | Timeout per approval request in safe mode |
| `claudeCwd` | `process.cwd()` | Default working directory when no thread override is set |
| `claudeBin` | `claude` | Claude CLI executable |
| `codexBin` | `codex` | Codex CLI executable |
| `opencodeBin` | `opencode` | OpenCode CLI executable |

Useful IM-specific optional fields:

- Discord IM record: `guildIds`, `allowedChannelIds`
- Feishu IM record: `baseUrl`, `port`, `modelSelectionTimeoutMs`, `verificationToken`, `encryptKey`
- Slack IM record: `socketMode`

---

## Runtime Directory Layout

```text
~/.agent-inbox/
  config.jsonl        # Main configuration file
  state/
    sessions.json     # Persistent session/control state across platforms
    feishu-session-chats.json  # Feishu private-launch session chat mapping
  artifacts/          # File exchange directory (incoming / outgoing)
  logs/               # Runtime logs
  pids/               # Per-platform single-instance lock files
```

---

## Project Structure

```text
apps/
  agent-inbox/        @doctorwu/agent-inbox   - End-user CLI entrypoint and interactive setup wizard

packages/
  core/               @agent-im-relay/core    - Shared runtime, session management, and backend abstractions
  discord/            @agent-im-relay/discord - Discord adapter
  feishu/             @agent-im-relay/feishu  - Feishu adapter
  slack/              @agent-im-relay/slack   - Slack adapter
  wechat/             @agent-im-relay/wechat  - WeChat adapter (via iLink)
```

Architecture design document: [docs/agent-inbox-architecture.md](docs/agent-inbox-architecture.md)

---

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Build all packages
pnpm build

# Start after building
pnpm start

# Development mode (run adapters independently)
pnpm dev:discord
pnpm dev:feishu
pnpm dev:slack
pnpm dev:wechat
```

All adapter development commands load configuration from `~/.agent-inbox/config.jsonl`.

### Build Outputs

- `apps/agent-inbox/dist/index.mjs` - npm package entrypoint, built with `pnpm --filter ./apps/agent-inbox build` via `vp pack`

---

## License

MIT
