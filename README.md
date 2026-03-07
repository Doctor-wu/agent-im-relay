# Agent Inbox

An inbox-first IM launcher for local Claude and Codex workflows. The repo still keeps a pnpm workspace for development, but the user-facing entry is now a single CLI app package that owns startup flow and runtime config.

## What Changed

- User-facing entry is `@agent-inbox/app`
- Runtime config and data default to `~/.agent-inbox/`
- Config file is `~/.agent-inbox/config.jsonl`
- Only configured IM integrations appear in the launcher
- Feishu is now single-process only
- Runtime no longer depends on repo-root `.env` as the primary user contract

## Runtime Layout

The launcher owns these paths:

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
  feishu/    @agent-im-relay/feishu   — Feishu single-process adapter runtime
```

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
