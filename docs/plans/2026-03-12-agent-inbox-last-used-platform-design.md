# Design: Agent Inbox Last-Used Platform Selection

**Date:** 2026-03-12

## Overview

Add machine-local persistence for the IM platform selected from the `agent-inbox` startup prompt.

The CLI should keep Discord first by default, remember the user's most recently selected platform using the existing `config.jsonl` storage flow, then move that platform to the top on the next launch and label it `Last used`.

## Scope

- Apply only to the startup prompt `Select a platform to start`
- Keep Discord first when no previous selection exists
- Persist the selected platform locally per machine
- Reorder the startup options so the last selected platform appears first on the next launch
- Show `Last used` in the startup options for the remembered platform
- Overwrite the stored value when the user manually selects a different platform

## Non-Goals

- Changing the setup prompt `Which platform to configure?`
- Adding cross-machine sync or account-level preferences
- Persisting anything beyond the last selected startup platform

## Design

### Storage

Reuse the existing `apps/agent-inbox/src/config.ts` JSONL config flow.

Add a new lightweight local-preference record to `config.jsonl` that stores only the last selected startup platform. This keeps the feature aligned with the current machine-local configuration model and avoids introducing a second persistence file.

### Startup ordering

`apps/agent-inbox/src/cli.ts` should build startup prompt options in this order:

1. The remembered platform, if present and still configured
2. Otherwise Discord first when it is configured
3. All remaining configured platforms in stable existing order
4. `Configure a new platform...` last when available

The remembered platform option should include the visible English hint `Last used`.

### Update flow

After the user manually selects a configured platform from the startup prompt, `agent-inbox` should overwrite the stored preference before launching the selected runtime.

If the stored platform is missing, invalid, or no longer configured, the CLI should ignore it and fall back to the default ordering without blocking startup.

### Error handling

- Missing config file: use current defaults and create the preference on first selection
- Invalid preference record: ignore it during ordering and overwrite it on the next valid selection
- Only one configured platform: still apply persistence, but the prompt behavior remains functionally unchanged

## Testing

- Config tests should cover parsing and serializing the new preference record
- CLI tests should cover Discord-first default ordering
- CLI tests should cover remembered-platform ordering plus the `Last used` label
- CLI tests should cover overwriting the stored platform after a new manual selection
