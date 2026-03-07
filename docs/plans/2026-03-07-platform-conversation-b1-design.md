# Design: Platform Conversation Orchestration (B1)

**Date:** 2026-03-07
**Status:** Approved

## Goal

Introduce a shared platform conversation orchestration boundary in `@agent-im-relay/core` so Discord and Feishu both depend on the same execution semantics for:

- backend gating
- control actions
- mode-aware conversation execution
- shared attachment and artifact handling
- phase/status lifecycle

Platform packages should keep only transport- and UI-specific concerns.

## Why B1

The current structure already shares low-level runner primitives, but higher-level conversation flow still lives inside platform packages. That creates duplicated policy around setup, action semantics, files, and phase handling.

B1 intentionally stops at the orchestration boundary. It does **not** attempt to unify Discord slash commands, Feishu cards, or message payload schemas.

## Shared Core Boundary

Add a new core module for platform conversation orchestration with three responsibilities:

### 1. Run request evaluation

Given a `conversationId`, `prompt`, and `mode`, core decides whether the request is ready to execute or requires setup first.

Example outcomes:

- `ready` with a concrete backend
- `setup-required` for backend selection

Platform packages render setup UI themselves, but the decision lives in core.

### 2. Control action semantics

Core should own the semantics for these actions:

- `interrupt`
- `done`
- `backend`
- `confirm-backend`
- `cancel-backend`
- `model`
- `effort`

This keeps state mutation and continuation rules in one place, while adapters only translate button/select payloads into normalized control actions.

### 3. Shared conversation execution wrapper

Core should expose a high-level helper that wraps:

- `runConversationWithRenderer`
- attachment prompt preparation
- outgoing artifact staging
- mode/backend/model/effort/cwd lookup
- phase callbacks

The helper still receives platform-owned callbacks for:

- streaming/rendering text
- sending warnings
- uploading files
- showing final controls

## Adapter Responsibilities

### Discord

Discord should become a thin adapter that:

- converts thread/message input into a normalized request
- delegates execution to core orchestration
- maps phase changes to reactions
- keeps Discord-specific thread setup UI where it already exists

### Feishu

Feishu should add:

- HTTP callback ingress
- Feishu API client
- callback payload parsing
- card rendering and card action parsing
- message/file transport implementation

Feishu should delegate the actual conversation policy to the new core orchestration module.

## Data Flow

### Incoming request

1. adapter receives user input
2. adapter normalizes into `{ conversationId, prompt, mode, attachments, target }`
3. core evaluates whether setup is required
4. adapter either shows setup UI or executes through shared orchestration
5. adapter-specific transport delivers text, controls, and files

### Control action

1. adapter parses raw UI action into normalized control action
2. core applies action semantics and returns a structured result
3. adapter renders confirmation/next UI
4. if action unblocks execution, adapter resumes the pending request

## Non-Goals

- general-purpose card/layout DSL
- general-purpose command framework
- encrypted Feishu callback support in this round
- shared persistence for platform-specific pending UI state beyond what core already owns

## Testing Strategy

- new core orchestration tests for run request evaluation and action semantics
- Discord regression tests updated to use the shared orchestration wrapper
- Feishu tests for callback ingress, API client, setup flow, control actions, and files
