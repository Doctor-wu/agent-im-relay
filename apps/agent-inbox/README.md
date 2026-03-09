# Agent Inbox CLI

`@doctorwu/agent-inbox` is the user-facing CLI launcher for local Claude and Codex workflows.

## Install

```bash
npm install -g @doctorwu/agent-inbox

# Or run without a global install
npx @doctorwu/agent-inbox
```

## First Run

On first run, the CLI creates `~/.agent-inbox/` as needed and enters the interactive setup flow automatically when no IM is configured yet. Users do not need to create `config.jsonl` manually before the first `npx` run.

## Runtime Output

- `dist/index.mjs` is the npm `bin` target
- `dist/agent-inbox` is the optional SEA executable built separately
