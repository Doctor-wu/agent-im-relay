# TS Check and Vite Plus Migration Design

## Context

`agent-im-relay` is a pnpm workspace with publishable packages under `packages/` and a CLI app under `apps/agent-inbox`. The current toolchain relies on `tsdown` for TypeScript builds, uses local source imports with `.js` suffixes, and still carries a Node SEA distribution path for `agent-inbox`.

The requested migration has three priorities:

1. Add a workspace-level TypeScript typecheck and make `tsc --noEmit` pass.
2. Remove `.js` suffixes from local TypeScript module imports.
3. Replace the existing build flow with `vite-plus`, while removing the SEA packaging path and keeping npm package distribution intact.

## Goals

- Add a repeatable workspace typecheck command that fails on real TypeScript issues.
- Make all workspace packages and the CLI app pass `tsc --noEmit`.
- Remove local `.js` suffixes from TypeScript source and test imports.
- Migrate package and app builds from `vite-plus`.
- Drop Node SEA build scripts, dependencies, and direct documentation references.
- Keep current npm-facing package outputs and CLI bin behavior working.

## Non-Goals

- Rewriting historical planning documents that mention `tsdown`, `.js` imports, or SEA.
- Re-architecting package boundaries or changing published package names.
- Adding new runtime features during the migration.

## Chosen Approach

Use a root-driven `vite-plus` migration for the whole workspace.

The migration will happen in two controlled phases:

1. Type safety phase
   - Introduce a root TypeScript check command.
   - Fix workspace `tsconfig` alignment issues.
   - Remove local `.js` import suffixes.
   - Resolve all resulting TypeScript errors.
2. Build migration phase
   - Replace `tsdown`-based package builds with `vite-plus`.
   - Remove SEA scripts and dependencies.
   - Keep package output contracts intact for npm distribution.

This keeps the highest-risk behavioral change, the build tool replacement, behind a verified type-safe baseline.

## Architecture

### Workspace and Isolation

- Work happens in a dedicated git worktree under `.worktrees/`.
- The baseline stays green before changes begin.
- Fresh verification runs after each migration phase to isolate regressions.

### Typecheck Strategy

- Root `tsconfig.json` remains the workspace entry point via project references.
- Each package/app `tsconfig` is aligned so `tsc --noEmit` can walk the workspace successfully.
- Typecheck coverage includes `packages/core`, `packages/discord`, `packages/feishu`, `packages/slack`, and `apps/agent-inbox`.
- The typecheck command should reflect actual source health rather than bundler-only behavior.

### Import Specifier Strategy

- Local TypeScript imports in source and tests use extensionless specifiers.
- Package imports remain unchanged.
- Output extensions remain the responsibility of the compiler and bundler.

### Build Strategy

- `vite-plus` becomes the build entry point for each publishable workspace package and the CLI app.
- Workspace configuration follows official `vite-plus` guidance, including pnpm overrides where required.
- Build outputs must remain compatible with the existing package contracts:
  - library packages continue shipping `dist/index.mjs` and declaration files
  - `agent-inbox` continues shipping `dist/index.mjs` as the CLI bin target

### SEA Removal

- Delete `apps/agent-inbox/scripts/build-executable.mjs`.
- Delete `apps/agent-inbox/scripts/sea-build.mjs`.
- Remove `build:sea`, `build:all`, `postject`, and other SEA-only references.
- Update direct documentation and package scripts so npm package distribution is the only supported path.

## Risks and Mitigations

### Risk: Removing `.js` suffixes changes runtime and test resolution

Mitigation:

- Make `tsc --noEmit` pass before bundler migration.
- Re-run package tests after the import cleanup.
- Re-run workspace builds after the build migration.

### Risk: `agent-inbox` has the highest coupling to build outputs

Mitigation:

- Migrate shared packages first.
- Keep `agent-inbox` as the last build target to switch.
- Verify `prepack` after the migration to preserve npm distribution behavior.

### Risk: `vite-plus` migration requires different config than `tsdown`

Mitigation:

- Follow the official `vite-plus` command and workspace setup guidance.
- Keep output filenames and package export fields stable unless a change is strictly required.

## Verification

The implementation is not complete until all of the following succeed in the worktree:

- `pnpm exec tsc --noEmit`
- `pnpm -r test`
- `pnpm -r build`
- `pnpm --filter @doctorwu/agent-inbox prepack`

## Expected Outcome

After the migration:

- the workspace has a real TypeScript typecheck gate
- local TS imports no longer use `.js` suffixes
- builds are powered by `vite-plus`
- SEA packaging is removed
- npm distribution remains functional
