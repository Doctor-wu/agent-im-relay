# agent-im-relay

[![GitHub release](https://img.shields.io/github/v/release/Doctor-wu/agent-im-relay)](https://github.com/Doctor-wu/agent-im-relay/releases)
![Node >=20](https://img.shields.io/badge/node-%3E%3D20-339933)
![pnpm workspace](https://img.shields.io/badge/pnpm-workspace-F69220)
![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6)
![Discord](https://img.shields.io/badge/platform-Discord-5865F2)
![Feishu long connection](https://img.shields.io/badge/platform-Feishu-long_connection-00B96B)

A platform-agnostic bridge that connects Claude AI to instant messaging platforms. Built as a pnpm monorepo with a shared core and per-platform adapter packages.

`agent-im-relay` lets you run agent workflows from chat threads while keeping the runtime logic portable across platforms. The shared core owns session state, streaming, interruption, backend integration, and orchestration; platform packages focus on delivery, UX, and command surfaces.

Feishu support is available through `@agent-im-relay/feishu` as a long-connection runtime that receives Feishu events directly over the official WebSocket channel. This round stays adapter-first: extract only the minimum shared runtime needed in `@agent-im-relay/core`, and keep Feishu-specific cards, ingress, and file transport in the Feishu package until the abstractions prove reusable.

## Highlights

- Shared core runtime for agent sessions, streaming, and interruption
- Discord adapter with thread-based conversations and slash commands
- Backend-agnostic control flow that can support multiple agent providers
- Monorepo structure that makes it easy to add more IM platforms over time
- Sticky per-thread agent sessions that stay continuous until explicit teardown with `/done`
- Backend-provided environment summaries appear only on real fresh starts, not ordinary follow-up messages
- Working directory overrides are managed separately from backend setup

## Project Structure

```
packages/
  core/       @agent-im-relay/core     — Agent session, orchestrator, state, types
  discord/    @agent-im-relay/discord   — Discord bot adapter
  feishu/     @agent-im-relay/feishu    — Feishu bot adapter (in progress)
```

### `@agent-im-relay/core`

Platform-agnostic foundation:

- **Agent** — Spawns Claude CLI sessions with streaming events
- **Orchestrator** — Drives the message → agent → reply flow through capability interfaces
- **State** — Sticky thread-session bindings, continuation snapshots, models, effort, cwd persistence
- **Skills** — Markdown-based skill discovery and parsing
- **Types** — `PlatformAdapter` and 6 capability interfaces (`MessageSender`, `ConversationManager`, `StatusIndicator`, `CommandRegistry`, `InteractiveUI`, `MarkdownFormatter`)

### `@agent-im-relay/discord`

Discord-specific implementation:

- Slash commands (`/ask`, `/code`, `/interrupt`, `/done`, `/skill`, `/model`, `/effort`, `/sessions`, `/cwd`, `/compact`)
- Streaming agent output with live message edits
- Thread-based conversation management
- Markdown → Discord formatting with embed support
- `/interrupt` stops the currently running agent task in the thread without tearing down the sticky session
- `/done` is the explicit teardown path that resets the thread to a fresh-start state next time
- Environment summaries show backend, model, working directory, git branch, and mode only on fresh starts
- `/cwd` manages per-thread working directory overrides; otherwise backends auto-detect the project directory
- Discord attachments are downloaded into per-conversation artifact storage before each run
- `/code` threads can return generated files by ending the final answer with an `artifacts` fenced JSON block
- `/ask` can read uploaded files but does not upload generated artifacts back to Discord in v1

### `@agent-im-relay/feishu`

Feishu-specific implementation with:

- Long-connection ingress through the Feishu event dispatcher and WebSocket client
- Menu-first session controls with an anchor-card fallback for backend, model, effort, interrupt, and done actions
- Private-chat launchers that create dedicated session chats and remember anchor metadata across restarts
- Sticky per-conversation session continuity until explicit teardown through `/done` or control actions
- Inbound file download and outbound artifact upload support
- Optional Feishu event verification and decryption settings via `FEISHU_VERIFICATION_TOKEN` and `FEISHU_ENCRYPT_KEY`

## Setup

```bash
# Install dependencies
pnpm install

# Copy and configure environment variables
cp .env.example .env
# Edit .env with the platform credentials you need

# Build all packages
pnpm build

# Run the Discord bot
pnpm dev:discord

# Run the Feishu long-connection runtime
pnpm dev:feishu
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_TOKEN` | Yes | — | Discord bot token |
| `DISCORD_CLIENT_ID` | Yes | — | Discord application client ID |
| `GUILD_IDS` | No | (all guilds) | Comma-separated guild IDs to restrict bot |
| `FEISHU_APP_ID` | Yes (Feishu) | — | Feishu app ID used by the long-connection runtime |
| `FEISHU_APP_SECRET` | Yes (Feishu) | — | Feishu app secret used for API access and WebSocket auth |
| `FEISHU_ENCRYPT_KEY` | No | — | Optional decrypt key when Feishu event encryption is enabled |
| `FEISHU_VERIFICATION_TOKEN` | No | — | Optional verification token passed to the Feishu event dispatcher |
| `FEISHU_BASE_URL` | No | `https://open.feishu.cn` | Override Feishu Open Platform base URL |
| `CLAUDE_MODEL` | No | (Claude default) | Claude model override |
| `CLAUDE_CWD` | No | `process.cwd()` | Working directory for Claude sessions |
| `AGENT_TIMEOUT_MS` | No | `600000` | Agent request timeout (ms) |
| `STATE_FILE` | No | `<cwd>/.agent-inbox/state/sessions.json` | Path to state persistence file |
| `ARTIFACTS_BASE_DIR` | No | `<cwd>/.agent-inbox/artifacts` | Base directory for inbound and outbound conversation files |
| `ARTIFACT_RETENTION_DAYS` | No | `14` | Lazy cleanup window for old conversation artifact directories |
| `ARTIFACT_MAX_SIZE_BYTES` | No | `8388608` | Max size for downloaded or uploaded artifacts |
| `STREAM_UPDATE_INTERVAL_MS` | No | `1000` | Discord message edit frequency (ms) |
| `DISCORD_MESSAGE_CHAR_LIMIT` | No | `1900` | Max characters per Discord message chunk |

If the current working directory is not writable, the relay falls back to a writable user or temp directory for `.agent-inbox`.

## Feishu Runtime Model

Feishu runs in a single long-connection process:

- The runtime opens Feishu's persistent event connection with `FEISHU_APP_ID` and `FEISHU_APP_SECRET`
- Incoming messages, card actions, and bot-menu actions are routed locally into the shared conversation runtime
- Session controls are menu-first, with a session anchor card kept in the session chat as a fallback surface

Typical startup flow:

1. In the Feishu developer console, enable persistent connection mode for event delivery.
2. Set `FEISHU_APP_ID` and `FEISHU_APP_SECRET`, plus `FEISHU_ENCRYPT_KEY` / `FEISHU_VERIFICATION_TOKEN` if your app uses them.
3. Start `pnpm dev:feishu` on the machine that has the agent CLI tools and working copy.
4. Use the bot menu to open session controls, or the session anchor fallback card if the menu is unavailable.

## File Transfer

Discord users can attach up to three files to `/code`, `/ask`, or active thread messages. By default the relay stores them under `<cwd>/.agent-inbox/artifacts/<conversationId>/incoming/` (or under `ARTIFACTS_BASE_DIR` if you override it) and prepends a short local-path summary to the agent prompt so the agent can read them with normal file tools.

For `/code` runs, the relay also injects an artifact return contract. If the agent wants Discord to receive generated files, it should end the final answer with an `artifacts` block like this:

````markdown
```artifacts
{
  "files": [
    {
      "path": "reports/summary.md",
      "title": "Implementation Summary",
      "mimeType": "text/markdown"
    }
  ]
}
```
````

Only the last valid `artifacts` block is used. Paths must stay inside the working directory or the conversation artifact directory. Approved files are copied into `<ARTIFACTS_BASE_DIR>/<conversationId>/outgoing/` before Discord upload. Oversized or invalid files are skipped with a warning instead of crashing the session.

## Development

```bash
# Run all tests
pnpm test

# Build all packages
pnpm build

# Run Discord bot in dev mode (with watch)
pnpm dev:discord

# Run Feishu long-connection runtime in dev mode (with watch)
pnpm dev:feishu
```

## Adding a New Platform

1. Create `packages/<platform>/` with its own `package.json` depending on `@agent-im-relay/core`
2. Implement the capability interfaces your platform needs (`MessageSender` is required, others are optional)
3. Create a `PlatformAdapter` factory that wires up your implementations
4. Use `Orchestrator.handleMessage()` or the lower-level `streamAgentSession()` to drive conversations
