# Agent Inbox

[![GitHub release](https://img.shields.io/github/v/release/Doctor-wu/agent-im-relay)](https://github.com/Doctor-wu/agent-im-relay/releases)
![Node >=20](https://img.shields.io/badge/node-%3E%3D20-339933)
![pnpm workspace](https://img.shields.io/badge/pnpm-workspace-F69220)
![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6)
![Discord](https://img.shields.io/badge/platform-Discord-5865F2)
![Feishu long connection](https://img.shields.io/badge/platform-Feishu-long_connection-00B96B)

Agent Inbox is an inbox-first IM launcher for local Claude and Codex workflows. The repo keeps a pnpm workspace for development, while `apps/agent-inbox` is the user-facing launcher and the packages under `packages/` hold the shared runtime plus IM adapters.

## What Changed

- User-facing entry is `@agent-inbox/app`
- Runtime config and data default to `~/.agent-inbox/`
- Config file is `~/.agent-inbox/config.jsonl`
- Only configured IM integrations appear in the launcher
- Feishu now runs as a single-process long-connection adapter
- Repo-root `.env` is development-only convenience, not the primary user contract

If `HOME` is unavailable or not writable, runtime state falls back to a writable `INIT_CWD`, current working directory, or temp directory before using `.agent-inbox/`.

## Runtime Layout

```text
~/.agent-inbox/
  config.jsonl
  state/
  artifacts/
  logs/
```

`config.jsonl` is line-oriented JSON. Each record can carry a `note` for user guidance.

Example:

```json
{"type":"meta","version":1}
{"type":"im","id":"discord","enabled":true,"note":"填写 Discord 机器人信息后可启动","config":{"token":"...","clientId":"..."}}
{"type":"im","id":"feishu","enabled":false,"note":"填写飞书应用信息后可启动","config":{}}
{"type":"runtime","note":"全局运行参数","config":{"agentTimeoutMs":600000}}
```

## Project Structure

```text
apps/
  agent-inbox/  @agent-inbox/app      — User-facing launcher, setup flow, config loading

packages/
  core/      @agent-im-relay/core     — Shared runtime, state, orchestration
  discord/   @agent-im-relay/discord  — Discord adapter runtime
  feishu/    @agent-im-relay/feishu   — Feishu adapter runtime
```

## Feishu Runtime

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

## Development

```bash
pnpm install
pnpm test
pnpm build
```

Useful entrypoints:

```bash
# Run the unified launcher after build
pnpm start

# Run Discord adapter directly in dev mode
pnpm dev:discord

# Run Feishu adapter directly in dev mode
pnpm dev:feishu
```

## Development Env File

Repo-root `.env` is now development-only convenience for direct package runs. The distributed launcher should prefer `~/.agent-inbox/config.jsonl`.

See `.env.example` for the reduced development surface.

## Current Build Target

The main distribution target is `apps/agent-inbox`. Its build now produces:

- `apps/agent-inbox/dist/index.mjs` — bundled launcher entry
- `apps/agent-inbox/dist/agent-inbox` — macOS executable generated from the bundled launcher

The launcher bundle no longer depends on the workspace layout at runtime, and the executable can be used as the distribution artifact for the current platform.
