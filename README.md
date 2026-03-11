# Agent Inbox

> Let local AI agents such as Claude Code and Codex receive tasks and reply with results directly inside Discord, Feishu, and other IM platforms, without any server. Everything runs on your own machine.

[![npm version](https://img.shields.io/npm/v/@doctorwu/agent-inbox)](https://www.npmjs.com/package/@doctorwu/agent-inbox)
[![GitHub release](https://img.shields.io/github/v/release/Doctor-wu/agent-im-relay)](https://github.com/Doctor-wu/agent-im-relay/releases)
![Node >=20](https://img.shields.io/badge/node-%3E%3D20-339933)
![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6)
![Discord](https://img.shields.io/badge/platform-Discord-5865F2)
![Feishu long connection](https://img.shields.io/badge/platform-Feishu-long_connection-00B96B)
![Telegram](https://img.shields.io/badge/platform-Telegram-26A5E4)

---

## Why Agent Inbox

- **Inbox-first workflow** - Send a message to the bot in your IM app, let the agent open a session automatically, execute the task, and send the result back with file upload and download support.
- **Multiple IM platforms** - Discord and Feishu are supported today, and the architecture is designed to extend cleanly to additional platforms.
- **Multiple agent backends** - Switch between Claude Code and OpenAI Codex depending on the task.
- **Runs locally with full data control** - Configuration and runtime state live in `~/.agent-inbox/`, with no cloud deployment required.
- **Persistent sessions** - Keep context across messages, interrupt and resume work, and isolate each session in its own working directory.

---

## Quick Start

### Step 1: Install

```bash
npm install -g @doctorwu/agent-inbox
# Or run it directly without a global install
npx @doctorwu/agent-inbox
```

### Step 2: Configure

On first launch, Agent Inbox starts an interactive setup wizard that walks you through the IM platform and agent backend configuration.

Configuration is stored in `~/.agent-inbox/config.jsonl`. Example:

```jsonc
{"type":"meta","version":1}
{"type":"im","id":"discord","enabled":true,"config":{"token":"your-bot-token","clientId":"your-client-id"}}
{"type":"im","id":"feishu","enabled":false,"config":{"appId":"","appSecret":""}}
{"type":"runtime","config":{"agentTimeoutMs":600000}}
```

### Step 3: Start

```bash
agent-inbox
```

After startup, send a message to your configured bot to begin interacting with the agent.

---

## Supported IM Platforms

| Platform | Status | Notes |
|------|------|------|
| **Discord** ⭐ Recommended | ✅ Supported | Slash commands + thread sessions, file upload/download support, streaming output |
| **Feishu (Lark)** | ✅ Supported | Long-connection mode, DM-triggered session groups, interrupt cards on every message |

### Discord Setup

Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications) and obtain its `Token` and `Client ID`.

Discord is the recommended platform for the best interactive workflow. It supports:

- `/code <prompt>` — Start a coding task and automatically create a dedicated thread for the session
- `/ask <question>` — Ask a quick question without file tools
- `/skill <name> <prompt>` — Invoke a predefined skill directly
- `/model <name>` — Switch the active agent model
- `/effort <level>` — Set the agent effort level
- `/interrupt` — Interrupt the current task
- `/done` — End the current session
- `@mention` — Mention the bot in a channel to trigger a conversation there as well

### Feishu Setup

Create a self-built enterprise application in the [Feishu Open Platform](https://open.feishu.cn), enable long-connection event subscriptions, and obtain the `App ID` and `App Secret`.

---

## Supported Agent Backends

| Backend | Notes |
|---------|------|
| **Claude Code** | Anthropic Claude with streaming output and tool calling |
| **OpenAI Codex** | OpenAI Codex CLI with streaming output |

You can switch the backend for the current session through the setup wizard or IM commands.

---

## Runtime Directory Layout

```text
~/.agent-inbox/
  config.jsonl        # Main configuration file
  state/              # Persistent session state
  artifacts/          # File exchange directory (incoming / outgoing)
  logs/               # Runtime logs
```

---

## Project Structure

```text
apps/
  agent-inbox/        @doctorwu/agent-inbox   - End-user CLI entrypoint and interactive setup wizard

packages/
  core/      @agent-im-relay/core     — Shared runtime, state, orchestration
  discord/   @agent-im-relay/discord  — Discord adapter runtime
  feishu/    @agent-im-relay/feishu   — Feishu adapter runtime
  telegram/  @agent-im-relay/telegram — Telegram adapter runtime
```

Architecture design document: [docs/agent-inbox-architecture.md](docs/agent-inbox-architecture.md)

The Feishu adapter now stays inside `@agent-im-relay/feishu` and uses the official persistent connection flow directly:

- Long-connection ingress through Feishu's event dispatcher and WebSocket client
- Private-chat launchers that create dedicated session chats and return native shared-chat receipts
- Session-group reference messages plus mirrored original prompts for readable context
- One-shot interrupt cards for each user message inside a session chat
- Sticky per-conversation session continuity until explicit teardown
- Inbound file download and outbound artifact upload support
- Optional event verification and decryption via `FEISHU_VERIFICATION_TOKEN` and `FEISHU_ENCRYPT_KEY`

Typical startup flow:

1. Enable persistent connection mode in the Feishu developer console.
2. Configure `FEISHU_APP_ID` and `FEISHU_APP_SECRET`, plus `FEISHU_ENCRYPT_KEY` / `FEISHU_VERIFICATION_TOKEN` if your app uses them.
3. Start `pnpm dev:feishu` on the machine that has the local agent CLI tools and workspace.
4. Send the bot a private message to create a `Session · {promptPreview}` chat, then continue inside that session chat with the per-message interrupt card.

## Telegram Runtime

The Telegram adapter uses [grammY](https://grammy.dev/) and supports three conversation modes:

- Private chat with the bot directly
- Group chat via `@mention` — bot replies in a reply thread per conversation
- Channel + Discussion Group — each channel post automatically triggers an agent session in its comment thread; replies in the thread continue the same session

Typical startup flow:

1. Create a bot via [@BotFather](https://t.me/BotFather), copy the token.
2. Disable Privacy Mode: `/mybots` → Bot Settings → Group Privacy → Turn off.
3. For channel mode: link a Discussion Group to your channel (channel Edit → Discussion), then add the bot as admin to both the channel and the discussion group.
4. Configure `TELEGRAM_BOT_TOKEN` and optionally `TELEGRAM_ALLOWED_USER_IDS`.
5. Start `pnpm dev:telegram`.

## Install

The primary distribution path is npm:

```bash
npm install -g @doctorwu/agent-inbox

# Or run without a global install
npx @doctorwu/agent-inbox
```

On first run, `agent-inbox` creates `~/.agent-inbox/` as needed and enters the interactive setup flow automatically when no IM is configured yet. Users do not need to create `config.jsonl` by hand before the first `npx` run.

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

# Run Telegram adapter directly in dev mode
pnpm dev:telegram
```

Use the repo root `.env` file for local environment variables during development. See `.env.example` for reference.

### Build Outputs

- `apps/agent-inbox/dist/index.mjs` - npm package entrypoint, built with `pnpm --filter ./apps/agent-inbox build`
- `apps/agent-inbox/dist/agent-inbox` - optional standalone executable (SEA), built with `pnpm --filter ./apps/agent-inbox build:sea`

---

## License

MIT
