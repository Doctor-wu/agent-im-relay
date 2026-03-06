# agent-im-relay

[![GitHub release](https://img.shields.io/github/v/release/Doctor-wu/agent-im-relay)](https://github.com/Doctor-wu/agent-im-relay/releases)
![Node >=20](https://img.shields.io/badge/node-%3E%3D20-339933)
![pnpm workspace](https://img.shields.io/badge/pnpm-workspace-F69220)
![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6)
![Discord](https://img.shields.io/badge/platform-Discord-5865F2)

A platform-agnostic bridge that connects Claude AI to instant messaging platforms. Built as a pnpm monorepo with a shared core and per-platform adapter packages.

`agent-im-relay` lets you run agent workflows from chat threads while keeping the runtime logic portable across platforms. The shared core owns session state, streaming, interruption, backend integration, and orchestration; platform packages focus on delivery, UX, and command surfaces.

## Highlights

- Shared core runtime for agent sessions, streaming, and interruption
- Discord adapter with thread-based conversations and slash commands
- Backend-agnostic control flow that can support multiple agent providers
- Monorepo structure that makes it easy to add more IM platforms over time
- Backend-provided environment summaries appear only on the first agent run in a thread
- Working directory overrides are managed separately from backend setup

## Project Structure

```
packages/
  core/       @agent-im-relay/core     — Agent session, orchestrator, state, types
  discord/    @agent-im-relay/discord   — Discord bot adapter
```

### `@agent-im-relay/core`

Platform-agnostic foundation:

- **Agent** — Spawns Claude CLI sessions with streaming events
- **Orchestrator** — Drives the message → agent → reply flow through capability interfaces
- **State** — Conversation sessions, models, effort, cwd persistence
- **Skills** — Markdown-based skill discovery and parsing
- **Types** — `PlatformAdapter` and 6 capability interfaces (`MessageSender`, `ConversationManager`, `StatusIndicator`, `CommandRegistry`, `InteractiveUI`, `MarkdownFormatter`)

### `@agent-im-relay/discord`

Discord-specific implementation:

- Slash commands (`/ask`, `/code`, `/interrupt`, `/done`, `/skill`, `/model`, `/effort`, `/resume`, `/sessions`, `/clear`, `/cwd`, `/compact`)
- Streaming agent output with live message edits
- Thread-based conversation management
- Markdown → Discord formatting with embed support
- `/interrupt` stops the currently running agent task in the thread without clearing saved session state
- `/done` ends the saved session for the thread without acting as an interrupt control
- Environment summaries show backend, model, working directory, git branch, and mode only on the first agent run in a thread
- `/cwd` manages per-thread working directory overrides; otherwise backends auto-detect the project directory
- Discord attachments are downloaded into per-conversation artifact storage before each run
- `/code` threads can return generated files by ending the final answer with an `artifacts` fenced JSON block
- `/ask` can read uploaded files but does not upload generated artifacts back to Discord in v1

## Setup

```bash
# Install dependencies
pnpm install

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your Discord bot token and client ID

# Build all packages
pnpm build

# Run the Discord bot
pnpm dev:discord
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_TOKEN` | Yes | — | Discord bot token |
| `DISCORD_CLIENT_ID` | Yes | — | Discord application client ID |
| `GUILD_IDS` | No | (all guilds) | Comma-separated guild IDs to restrict bot |
| `CLAUDE_MODEL` | No | (Claude default) | Claude model override |
| `CLAUDE_CWD` | No | `process.cwd()` | Working directory for Claude sessions |
| `AGENT_TIMEOUT_MS` | No | `600000` | Agent request timeout (ms) |
| `STATE_FILE` | No | `data/sessions.json` | Path to state persistence file |
| `ARTIFACTS_BASE_DIR` | No | `data/artifacts` | Base directory for inbound and outbound conversation files |
| `ARTIFACT_RETENTION_DAYS` | No | `14` | Lazy cleanup window for old conversation artifact directories |
| `ARTIFACT_MAX_SIZE_BYTES` | No | `8388608` | Max size for downloaded or uploaded artifacts |
| `STREAM_UPDATE_INTERVAL_MS` | No | `1000` | Discord message edit frequency (ms) |
| `DISCORD_MESSAGE_CHAR_LIMIT` | No | `1900` | Max characters per Discord message chunk |

## File Transfer

Discord users can attach up to three files to `/code`, `/ask`, or active thread messages. The relay stores them under `data/artifacts/<conversationId>/incoming/` and prepends a short local-path summary to the agent prompt so the agent can read them with normal file tools.

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

Only the last valid `artifacts` block is used. Paths must stay inside the working directory or the conversation artifact directory. Approved files are copied into `data/artifacts/<conversationId>/outgoing/` before Discord upload. Oversized or invalid files are skipped with a warning instead of crashing the session.

## Development

```bash
# Run all tests
pnpm test

# Build all packages
pnpm build

# Run Discord bot in dev mode (with watch)
pnpm dev:discord
```

## Adding a New Platform

1. Create `packages/<platform>/` with its own `package.json` depending on `@agent-im-relay/core`
2. Implement the capability interfaces your platform needs (`MessageSender` is required, others are optional)
3. Create a `PlatformAdapter` factory that wires up your implementations
4. Use `Orchestrator.handleMessage()` or the lower-level `streamAgentSession()` to drive conversations
