# Design: Backend-Owned Model Capabilities

**Date:** 2026-03-10

## Overview

Refactor backend and model configuration so model support is owned by each backend instead of the relay layer or platform UIs.

The key change is to treat backend capabilities as runtime-discovered data:

- relay config keeps CLI discovery and filesystem/runtime settings
- each backend reports whether it is available and which models it supports
- new-session setup flows ask the user to choose both backend and model from detected capabilities
- platform control panels stop hardcoding backend/model choices

## Scope

- Remove relay-level model config such as `claudeModel` from `packages/core`
- Extend the backend interface with model capability discovery
- Add shared helpers that return available backends together with supported models
- Update Discord and Feishu new-session setup flows to require backend and model selection
- Update session controls and summaries to use dynamic model lists
- Persist conversation model selections independently from relay config defaults

## Non-Goals

- Replacing per-conversation model persistence
- Adding a generic provider abstraction beyond the current backend registry
- Guaranteeing identical model discovery mechanics across all CLIs

## Design

### Capability ownership

`AgentBackend` becomes the source of truth for:

- `name`
- `isAvailable()`
- `getSupportedModels()`
- `stream()`

`packages/core/src/agent/backend.ts` exposes shared helpers for:

- listing registered backends
- filtering to locally available backends
- returning full backend capability payloads for platform setup UIs

This keeps platform code transport-focused and removes backend/model knowledge from Discord and Feishu.

### Model discovery

Each backend uses a backend-specific resolver chain:

- `codex`: read local model cache from `~/.codex/models_cache.json`, with current configured model as a fallback
- `opencode`: prefer `opencode models`, then fall back to local config/provider metadata
- `claude`: use locally available Claude config/cache sources and keep the resolver isolated behind the Claude backend

The implementation is best-effort but must remain backend-owned. Platforms only consume the returned list and do not hardcode model names.

### Session state

Conversation state keeps:

- selected backend
- selected model
- selected effort
- cwd override

Backend changes clear or preserve state according to compatibility:

- switching backend still follows the existing continuation-clear confirmation flow
- if the selected model is not supported by the new backend, clear the stored model
- if a backend exposes no models, allow the conversation to continue with backend defaults

### Platform setup flow

New-session setup becomes capability-driven:

- Discord thread setup prompts for backend first, then model for that backend
- Feishu backend gate prompts for backend first, then model before resuming the queued run
- session control panels render backend and model actions from the same capability data

The first run in a new conversation should not start until the required selections are complete, unless the chosen backend reports no selectable models.

## Error handling

- No available backends: return the existing "No available backends detected" behavior
- Backend available but model detection fails: treat as no selectable models and fall back to backend defaults
- Stored model becomes invalid after detection changes: ignore it for execution and clear it on the next explicit backend switch or settings update

## Testing

- Core tests cover backend capability helpers, model-clearing behavior on backend switch, and state persistence
- Discord tests cover backend+model thread setup and dynamic control rendering
- Feishu tests cover backend gate, follow-up model selection, and dynamic card payloads
- Workspace verification runs `pnpm test`
