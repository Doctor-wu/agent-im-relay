# Design: User-Facing README Refresh And Discord Setup Guide

**Date:** 2026-03-10

## Overview

Refresh the repository landing docs so GitHub visitors immediately understand the product as a user-facing tool, not just a TypeScript monorepo.

The new `README.md` should lead with product value, setup speed, and supported integrations. Detailed repository and architecture information should remain available, but move lower on the page.

Add a dedicated English guide for Discord setup so users can configure the bot without reverse-engineering config fields from code.

## Scope

- Rewrite the root `README.md` in English
- Reorder README sections so user-facing content comes first
- Keep platform and backend support visible near the top
- Add `docs/discord-setup.md` with a practical Discord bot setup walkthrough
- Link the Discord guide from the README quick-start flow

## Non-Goals

- Changing runtime behavior
- Adding new setup automation
- Reworking Feishu documentation in this task

## README Structure

1. Product title, badges, and architecture image
2. Short product summary
3. Feature highlights
4. Quick start in exactly three steps: install, configure, run
5. Supported platform list
6. Supported backend list
7. Technical details after the user-facing sections:
   - configuration example
   - runtime data layout
   - repository layout
   - development commands

## Discord Guide Structure

1. What values the app needs: bot token, application client ID, optional guild IDs
2. Create a Discord application and bot
3. Enable the intents required by this project
4. Generate a guild install invite with bot and application command scopes
5. Recommended bot permissions for thread creation, messaging, attachments, reactions, and slash commands
6. Finish local `agent-inbox` configuration and verify the bot in a server

## Source Of Truth

- Project code for command names, config fields, and runtime behavior
- Official Discord developer docs for intents, OAuth2 scopes, and permission terminology

## Verification

- Review rendered Markdown for information order and clarity
- Run a focused repo test/build command to ensure docs-only changes do not break the workspace
