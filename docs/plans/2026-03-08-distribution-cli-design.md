# Distribution CLI Design

**Date:** 2026-03-08

## Goal

Turn `agent-im-relay` into a user-facing runnable program that is prepared for distribution, no longer depends on a pnpm workspace layout at runtime, and minimizes setup cost for end users.

## Scope

- Add a single user-facing CLI entrypoint
- Move runtime configuration and data into `~/.agent-im-relay/`
- Replace repo-root `.env` as the default runtime config source
- Simplify config surface for first-run onboarding
- Keep only configured IM integrations visible to users
- Collapse Feishu into a single-process runtime model
- Prepare the build for standalone distribution-friendly artifacts

## Non-Goals

- No backend capability detection in this round
- No backend path configuration UX in this round
- No Feishu split deployment mode
- No installer or daemon manager

## User-Facing Product Model

The distributed program exposes one entrypoint: `agent-im-relay`.

On launch:

1. Read config from `~/.agent-im-relay/config.jsonl`
2. If no valid IM configuration exists, enter an interactive setup flow
3. Let the user choose only from configured IM integrations
4. Start the chosen runtime

Users should think in terms of:

- IM: `discord`, `feishu`, future IMs
- Backend: runtime choice only, not configuration-heavy setup

Users should not need to understand:

- monorepo packages
- workspace-local `.env`
- `STATE_FILE`, `ARTIFACTS_BASE_DIR`
- Feishu gateway/client split
- backend binary paths

## Configuration Model

The program owns a fixed home directory:

- `~/.agent-im-relay/config.jsonl`
- `~/.agent-im-relay/state/`
- `~/.agent-im-relay/artifacts/`
- `~/.agent-im-relay/logs/`

`config.jsonl` stores independent records. Each line is valid JSON and may include human-facing hints.

Record types for this round:

- `meta`
- `im`
- `runtime`

Example:

```json
{"type":"meta","version":1}
{"type":"im","id":"discord","enabled":true,"note":"填写 Discord 机器人信息后可启动","config":{"token":"...","clientId":"..."}}
{"type":"im","id":"feishu","enabled":false,"note":"填写飞书应用信息后可启动","config":{}}
{"type":"runtime","note":"全局运行参数","config":{"agentTimeoutMs":600000}}
```

Rules:

- Only configured and valid IM records are shown in the launcher
- Users may configure one IM without filling every possible IM
- State and artifact paths are derived, not configured
- Backend path and cwd knobs are removed from the user config surface

## Runtime Architecture

Keep the current package split for implementation reuse:

- `packages/core`: shared runtime and orchestration
- `packages/discord`: Discord adapter logic
- `packages/feishu`: Feishu adapter logic

Add a new app/distribution layer that becomes the user-facing executable:

- new app at `apps/agent-im-relay` for CLI entrypoint, interactive setup, config loading, startup dispatch

Feishu changes:

- keep only single-process startup
- remove the managed gateway/local client split from product and code paths

## Startup Flow

### First Run

1. Ensure `~/.agent-im-relay/` exists
2. Load `config.jsonl`
3. If no valid IM exists, launch interactive onboarding
4. Persist selected IM config and runtime defaults
5. Start the runtime immediately

### Later Runs

1. Load `config.jsonl`
2. Resolve valid IMs
3. If one IM is available, start it directly or with a lightweight confirmation
4. If multiple IMs are available, let the user choose from configured entries only

## Config Simplification

Remove these user-facing runtime knobs from the default setup:

- `CLAUDE_BIN`
- `CODEX_BIN`
- `CLAUDE_CWD`
- `STATE_FILE`
- `ARTIFACTS_BASE_DIR`
- Feishu split-deployment variables such as `FEISHU_GATEWAY_URL`, `FEISHU_CLIENT_ID`, `FEISHU_CLIENT_TOKEN`

Keep only necessary per-IM credentials and a small runtime surface.

## Build and Distribution Direction

The runtime should no longer require the monorepo workspace shape once built.

The new CLI app should become the main distribution target, using tsdown’s current Node-target bundling capabilities to emit distribution-friendly output. The implementation should keep entrypoints explicit and app-local so the produced artifact can run independently of workspace package resolution at runtime.

## Error Handling

- Invalid or malformed JSONL lines should produce actionable config errors
- Missing required IM fields should mark that IM as unavailable without crashing the whole config loader
- Missing backend CLIs should fail at execution time with install guidance
- First-run setup failures should not leave partial invalid config behind

## Testing

Add coverage for:

- JSONL config parsing and persistence
- selective IM availability based on configured records
- first-run bootstrap behavior
- CLI dispatch to Discord and Feishu runtimes
- Feishu single-process startup after split-deployment removal

## Migration

For this round, prioritize the new `~/.agent-im-relay/` path and the new CLI package. Existing repo-root `.env` support may remain temporarily for development, but the distributed program must not depend on it as its primary configuration contract.
