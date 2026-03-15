# Agent Inbox Config Standardization Design

## Goal

Standardize all runtime configuration loading on `~/.agent-inbox/config.jsonl` and remove every remaining package-level `.env` / `dotenv` bootstrap path.

## Problem

The repository currently uses two configuration systems:

- `apps/agent-inbox` reads and writes `~/.agent-inbox/config.jsonl`
- `packages/core`, `packages/discord`, `packages/feishu`, and `packages/slack` still bootstrap from `.env` and `process.env`

This split causes schema drift, duplicate validation, and inconsistent behavior between launcher-driven flows and standalone package entrypoints.

## Design

### Single Source Of Truth

`packages/core` owns the shared config schema and the disk I/O for `~/.agent-inbox/config.jsonl`. It exposes:

- record types for `meta`, `runtime`, `local-preferences`, and `im` records
- JSONL load/save helpers
- per-platform typed readers for Discord, Feishu, and Slack
- shared runtime defaults and path derivation

`apps/agent-inbox` stops defining its own schema and instead reuses the shared `core` types and helpers.

### Config Schema

The JSONL file keeps the existing top-level record shape and adds Slack as another `im` record:

```json
{"type":"im","id":"slack","enabled":true,"config":{"botToken":"x","appToken":"x","signingSecret":"x","socketMode":true}}
```

This aligns with the existing Discord and Feishu records:

- `type: "im"`
- `id` identifies the platform
- `enabled` gates runtime availability
- `note` is optional metadata
- `config` holds platform-specific fields

### Package Integration

Each runtime package keeps its public `read*Config()` entrypoint, but the default behavior changes:

- `readCoreConfig()` reads runtime defaults and resolved paths from the shared JSONL config
- `readDiscordConfig()` reads the shared config file and returns a typed Discord config
- `readFeishuConfig()` reads the shared config file and returns a typed Feishu config
- `readSlackConfig()` reads the shared config file and returns a typed Slack config

Standalone package entrypoints continue to work, but they now bootstrap only from `~/.agent-inbox/config.jsonl`.

### Compatibility Boundary

This migration changes only configuration sourcing and config assembly. It does not intentionally change:

- runtime startup order
- backend execution behavior
- message routing
- persisted state file layout

Process environment writes may remain as an internal compatibility bridge where existing runtime code still expects env values, but env is no longer a source of truth and `.env` is not read anywhere.

## Error Handling

Shared config loading should continue to distinguish between:

- malformed JSONL records
- missing required per-platform fields
- invalid numeric or boolean runtime values
- missing platform records when a standalone package starts

Errors should stay explicit and platform-specific so standalone invocations fail with actionable messages.

## Verification

Verification focuses on proving the source of truth moved successfully:

1. `core` tests cover JSONL parsing, Slack record support, and typed platform readers.
2. `discord`, `feishu`, and `slack` tests prove `read*Config()` defaults to `~/.agent-inbox/config.jsonl`.
3. `apps/agent-inbox` tests prove setup/load/save reuse the shared schema and include Slack.
4. Repository scans confirm package code no longer imports `dotenv` or references `.env`.

## Migration Outcome

After the migration:

- all runtime packages read configuration from `~/.agent-inbox/config.jsonl`
- launcher and standalone entrypoints use the same schema
- redundant `dotenv` dependencies can be removed
- documentation no longer instructs users to use a repo-root `.env`
