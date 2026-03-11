# Design: Backend `listModels()` for Relay Model Selection

**Date:** 2026-03-11

## Overview

Restore backend-owned model listing through a single internal API named `listModels()`.

The relay and IM integrations already consume backend capability data to present backend/model choices. This change keeps that flow, but renames the backend contract from `getSupportedModels()` to `listModels()` and tightens each backend's model-listing behavior.

## Scope

- Rename the internal backend model-listing API from `getSupportedModels()` to `listModels()`
- Keep the existing backend capability payload shape and setup/control flows
- Hardcode Claude model aliases to `sonnet`, `opus`, `haiku`, and `sonnet1m`
- Update OpenCode model discovery to read `~/.config/opencode/opencode.json` and emit `provider/modelKey`
- Keep Codex model discovery behavior unchanged apart from the API rename
- Ensure relay/UI surfaces the returned models and passes the selected value through unchanged

## Non-Goals

- Changing the existing session-state shape for backend/model selection
- Adding compatibility shims for `getSupportedModels()`
- Reworking backend/model setup UX beyond what is needed to consume `listModels()`
- Changing Codex model discovery semantics

## Design

### Backend contract

`AgentBackend` exposes:

- `name`
- `isAvailable()`
- `listModels()`
- `stream()`

Shared helpers in `packages/core/src/agent/backend.ts` keep normalizing, deduplicating, and packaging model lists into backend capabilities. Only the method name changes at the contract layer.

### Backend-specific listing

- `claude`: return four fixed aliases with identical `id` and `label` values
- `codex`: preserve the current cache/config lookup logic, only rename the exported method
- `opencode`: parse `~/.config/opencode/opencode.json`, iterate every provider under `provider`, then iterate every model key under `provider.<name>.models`, returning `providerName/modelKey`

OpenCode labels default to the same `providerName/modelKey` string so relay layers do not need provider-specific formatting logic.

### Relay and IM flow

The relay, Discord setup, and Feishu setup/control flows continue consuming backend capability data. Their behavior changes only through the renamed backend helper path and the new OpenCode model IDs.

If a backend returns an empty list from `listModels()`, the existing behavior remains:

- backend selection is still required where applicable
- model selection is skipped
- the backend default model is used at execution time

### Execution behavior

Conversation state continues storing the selected model string. Relay/UI passes the selected string unchanged to the backend runtime.

For OpenCode execution, the CLI `--model` argument must now receive the selected `provider/modelKey` value directly. Runtime code must not prepend or rewrite the selected model, or it will corrupt the value chosen by the user.

## Testing

- Core tests cover the renamed backend contract and capability helpers
- Claude backend tests assert the fixed alias list
- OpenCode backend tests assert parsing of `provider/modelKey` values from config
- Existing Discord and Feishu setup/control tests continue proving that relay/UI surfaces selectable models and persists the chosen value
- Workspace verification runs `pnpm test`
