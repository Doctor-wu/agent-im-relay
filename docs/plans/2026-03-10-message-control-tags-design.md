# Design: Message Control Tags For Backend Selection

**Date:** 2026-03-10

## Overview

Add a transport-agnostic message control format so backend selection can be driven by plain message text instead of only Discord or Feishu UI controls.

The initial control tag is:

```text
<set-backend>claude</set-backend>
<set-backend>codex</set-backend>
```

## Scope

- Parse control tags in `@agent-im-relay/core`
- Support both standalone control messages and mixed messages that include control tags plus normal prompt text
- Apply the parsed backend change before deciding whether to continue with a conversation run
- Reuse the same parsing and execution flow from Discord and Feishu

## Non-Goals

- General XML command language
- Platform-specific text command parsers
- New UI controls

## Behavior

### Parsing

- Extract every supported control tag from the incoming message
- Remove recognized tags from the message body
- Normalize remaining text with trimmed whitespace
- Reject unsupported backend values by leaving the tag text in the prompt so it is treated as ordinary user content

### Execution

- Convert parsed tags into core-level message control directives
- Apply those directives through a shared core helper that delegates to the existing session-control controller
- Auto-confirm backend switches triggered by text control tags because the tag itself is the explicit user or bot instruction
- Persist state only when controller effects require persistence
- If the cleaned prompt is empty after removing tags, do not start an agent run
- If the cleaned prompt is non-empty, continue with the existing conversation flow using the updated backend state

### Cross-Platform Integration

- Discord mention and thread messages preprocess the prompt before calling `runMentionConversation()`
- Feishu message handling preprocesses the extracted text before backend gating and run dispatch
- Existing UI-based backend controls remain unchanged and continue to use the same controller

## Testing

- Core unit tests cover parsing, command extraction, whitespace cleanup, and invalid tag fallback
- Discord tests cover mixed control-tag plus prompt flows
- Feishu tests cover standalone and mixed control-tag message flows
