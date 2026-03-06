# Discord CWD UI Removal Design

**Date:** 2026-03-06

## Summary
Simplify the first-run thread setup flow by removing all user-facing working-directory configuration from Discord. Keep backend selection, but remove the cwd select menu, the extra start confirmation button, and the `/cwd` slash command family. Backend selection should apply immediately.

## Goals
- Keep the initial thread setup lightweight and less awkward.
- Preserve backend choice for users who want Claude vs Codex.
- Remove all cwd-related interactive controls from Discord.

## Non-Goals
- Removing internal cwd detection from agent backends.
- Reworking persisted state formats.
- Changing model, effort, resume, sessions, clear, compact, interrupt, or done commands.

## Design
### Setup UI
`packages/discord/src/commands/thread-setup.ts` will render only one select menu for backend choice. Once the user selects a backend, setup resolves immediately and the setup message is edited to a simple confirmation. No separate start button remains.

### Slash Commands
`packages/discord/src/commands/claude-control.ts` will stop registering `/cwd` and remove its handler implementation. This removes `set`, `list`, `add`, and `remove` subcommands together.

### Runtime Behavior
Discord should stop offering cwd save/ignore buttons after automatic cwd detection. Internal `conversationCwd` bookkeeping may remain so resumed or continued runs can still use the detected path, but users no longer manage cwd manually through Discord controls.

### Testing
Add or update Discord tests to cover:
- thread setup only exposing backend interaction semantics
- slash command registration list no longer containing `cwd`
- no regression to existing thread conversation behavior
