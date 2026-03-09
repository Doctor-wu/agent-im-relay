# NPM Distribution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `apps/agent-inbox` publishable as the primary npm CLI distribution target, keep first-run `npx` onboarding intact, and demote SEA to an optional CI artifact that does not block npm release flow.

**Architecture:** Keep `apps/agent-inbox` as the only user-facing CLI package and publish its bundled `dist/index.mjs` as the npm `bin` under `@doctorwu/agent-inbox`. Rename the workspace root package so it no longer collides with the app package, switch root scripts to path-based targeting, and update CI so npm publish is primary while SEA stays as a best-effort artifact.

**Tech Stack:** pnpm workspace, TypeScript, Vitest, tsdown, GitHub Actions, npm publish

---

## Task 1: Lock the npm packaging contract with tests

**Files:**
- Create: `apps/agent-inbox/src/__tests__/packaging.test.ts`
- Modify: `apps/agent-inbox/src/__tests__/cli.test.ts`

**Step 1: Write the failing tests**

Add tests that assert:
- the workspace root package name differs from the app package name
- the root `start` script targets `apps/agent-inbox` by path instead of a missing package name
- the app package exposes `bin.agent-inbox = dist/index.mjs`
- the app package declares `engines.node >=20`
- the app package limits publish contents with a `files` allowlist
- `runCli()` enters setup when no IM is configured so `npx <package>` first-run onboarding is protected by tests

**Step 2: Run test to verify it fails**

Run: `pnpm --filter ./apps/agent-inbox test src/__tests__/packaging.test.ts src/__tests__/cli.test.ts`

Expected: FAIL because the packaging test file does not exist yet and the new CLI regression expectation is not present yet.

**Step 3: Write minimal implementation**

Add the metadata regression test file and the new CLI first-run regression test without changing production code yet.

**Step 4: Run test to verify it passes or fails for the right reasons**

Run: `pnpm --filter ./apps/agent-inbox test src/__tests__/packaging.test.ts src/__tests__/cli.test.ts`

Expected: FAIL on current package metadata and root script contract, while the first-run CLI regression either passes immediately or confirms the current behavior.

## Task 2: Make the workspace and app package publish-ready

**Files:**
- Modify: `package.json`
- Modify: `apps/agent-inbox/package.json`

**Step 1: Write the failing test**

Use the Task 1 packaging tests as the red state for package identity and publish metadata.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter ./apps/agent-inbox test src/__tests__/packaging.test.ts`

Expected: FAIL because the root and app package names still collide, the root `start` script still points at `@agent-inbox/app`, and the app package does not yet have the publish-focused metadata.

**Step 3: Write minimal implementation**

Update:
- root package name to a private workspace-only name
- root `start` script to target `./apps/agent-inbox`
- app package metadata to keep `bin.agent-inbox`
- app package name to `@doctorwu/agent-inbox`
- app `engines.node` to `>=20`
- app `files` allowlist for publish output
- app publish scripts (`prepack` or `prepublishOnly`) that build before publish

**Step 4: Run test to verify it passes**

Run: `pnpm --filter ./apps/agent-inbox test src/__tests__/packaging.test.ts src/__tests__/cli.test.ts`

Expected: PASS

## Task 3: Make npm publish the primary release flow and SEA optional

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `README.md`

**Step 1: Write the failing test or verification target**

Define the release contract to verify:
- npm publish is the primary tag-time release path
- SEA artifacts are optional and do not block npm publish
- README install instructions lead with `npm install -g` and `npx`
- README explains that first run goes through the interactive setup flow

**Step 2: Run the verification target to confirm the current gap**

Run:
- `rg -n "npm install -g|npx|publish" README.md .github/workflows/release.yml`

Expected: current docs and workflow do not yet describe npm as the primary distribution path.

**Step 3: Write minimal implementation**

Update the workflow so:
- a dedicated npm publish job runs on tags
- the publish job only proceeds for `@doctorwu/agent-inbox`
- SEA build jobs remain optional and non-blocking for npm publish

Update README so:
- installation examples use `npm install -g <package>` and `npx <package>`
- first-run onboarding is documented
- SEA is described as optional release artifact rather than the primary contract

**Step 4: Run verification to confirm the new contract**

Run:
- `rg -n "npm install -g|npx|publish" README.md .github/workflows/release.yml`

Expected: matches now show npm-first docs and workflow language.

## Task 4: Verify publishable outputs and first-run behavior end to end

**Files:**
- Modify as needed based on verification findings

**Step 1: Run targeted tests**

Run:
- `pnpm --filter ./apps/agent-inbox test src/__tests__/packaging.test.ts src/__tests__/cli.test.ts src/__tests__/setup.test.ts`

Expected: PASS

**Step 2: Run build verification**

Run:
- `pnpm --filter ./apps/agent-inbox build`
- `pnpm start`

Expected:
- app build succeeds
- root `pnpm start` reaches the app package instead of "No projects matched"

**Step 3: Run publish/pack smoke checks**

Run:
- `tmpdir=$(mktemp -d /tmp/agent-inbox-pack-XXXXXX) && pnpm --filter ./apps/agent-inbox pack --pack-destination "$tmpdir" && tar -tzf "$tmpdir"/*.tgz | sed -n '1,80p'`

Expected:
- one app tarball is created from `apps/agent-inbox`
- published contents are limited to the intended files

**Step 4: Run first-run smoke check**

Run:
- `tmpdir=$(mktemp -d /tmp/agent-inbox-home-XXXXXX) && HOME="$tmpdir" node apps/agent-inbox/dist/index.mjs`

Expected:
- CLI enters the interactive setup flow without requiring a pre-existing config file

**Step 5: Record remaining follow-up**

Document any remaining non-blocking warnings from the build and release flow, such as existing `tsdown` warnings that do not affect npm pack/install correctness.
