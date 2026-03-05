# Discord Claude Bridge

A Discord bot that lets users interact with Claude Code directly in Discord threads.

## Tech Stack
- TypeScript (strict mode)
- discord.js v14
- @anthropic-ai/claude-agent-sdk
- Node.js 20+
- pnpm as package manager

## Architecture
- `src/index.ts` — Bot entry point, Discord client setup
- `src/commands/` — Slash command handlers
  - `code.ts` — `/code <prompt>` — Start a coding task in a new thread
  - `ask.ts` — `/ask <question>` — Ask Claude a question (no file tools)
- `src/agent/` — Claude Agent SDK integration
  - `session.ts` — Manages agent sessions, wraps query() with streaming
  - `tools.ts` — Tool configuration and allowed tools presets
- `src/discord/` — Discord utilities
  - `stream.ts` — Stream agent output to Discord (edit messages in chunks)
  - `thread.ts` — Thread creation and management
- `src/config.ts` — Environment config (DISCORD_TOKEN, ANTHROPIC_API_KEY, etc.)

## Key Requirements
1. When user runs `/code <prompt>`, bot creates a thread and streams Claude's work there
2. Agent output is streamed — bot edits its message every ~1s with new content
3. Tool usage (file reads, edits, bash commands) shown as formatted blocks
4. Support `/ask` for quick questions without file system tools
5. Error handling: timeouts, rate limits, graceful shutdown
6. Use environment variables for all secrets (dotenv)

## Code Style
- ESM modules
- Strict TypeScript
- No classes unless necessary, prefer functions
- Use async/await, no callbacks
- Minimal dependencies
- No comments that just restate the code

## Setup
- pnpm init, install deps
- tsconfig.json with strict mode, ESM
- .env.example with required vars
- .gitignore for node_modules, .env, dist
