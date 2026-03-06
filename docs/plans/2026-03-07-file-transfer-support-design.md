# Design: File Transfer Support for `agent-im-relay`

**Date:** 2026-03-07
**Status:** Approved

## Overview

Add bidirectional file support to `agent-im-relay` so Discord users can send attachments into agent sessions and agents can return generated files back into Discord threads. The first version supports all file types as local files, adds light enhancements for images / Markdown / PDF, and keeps audio / video as pass-through files.

## Goals

- Support **user → agent** file delivery for `/code`, thread mentions, and `/ask`
- Support **agent → user** file return for `/code` and active code threads
- Persist attachment metadata separately from session state so `/resume` can continue to reference recent files
- Keep the core runtime platform-agnostic so future adapters can reuse the same artifact flow

## Non-Goals

- Cloud-link import (Google Drive, Dropbox, Notion, etc.)
- Built-in OCR, ASR, video analysis, or transcoding services
- Large-file chunking or bypassing Discord upload limits
- Agent-returned file uploads in `/ask` v1

## Architecture

### Core: Conversation Artifact Store

Add a core artifact layer that owns file metadata, conversation directories, artifact parsing, and cleanup policy.

Suggested module layout:

```text
packages/core/src/
  artifacts/
    store.ts        # conversation-scoped paths, metadata read/write, retention helpers
    protocol.ts     # artifacts fenced-block parser + path validation
    types.ts        # metadata models
```

Responsibilities:

- Allocate per-conversation directories under `data/artifacts/<conversationId>/`
- Store lightweight metadata in `meta.json`
- Keep session state small by persisting only metadata, not file contents
- Parse agent-declared artifact manifests from final output
- Validate outgoing artifact paths stay within allowed directories

### Discord: Attachment Ingest + Artifact Delivery

Discord remains responsible for platform-specific I/O:

- Download Discord attachments from messages
- Save them into the core-provided conversation directory
- Build a prompt prefix that tells the agent where files were stored
- Upload validated outgoing artifacts back into the thread after the agent finishes

## Data Flow

### User → Agent

1. User sends a message in a code thread, or uses `/code` or `/ask`
2. Discord adapter collects message attachments
3. Relay downloads attachments into `data/artifacts/<conversationId>/incoming/`
4. Relay records attachment metadata in `meta.json`
5. Relay prepends an attachment context block to the prompt with:
   - original file name
   - saved local path
   - MIME type / inferred kind
   - file size
   - light preview when available
6. Agent sees ordinary local file paths and can read them using existing tools

### Agent → User

1. Relay instructs the agent to declare returnable files in a final fenced block named `artifacts`
2. Agent writes files into the working directory and emits an `artifacts` block in the final answer
3. Relay parses the last valid `artifacts` block, validates each file, and records it in outgoing metadata
4. Discord adapter uploads approved files to the thread and posts a short summary
5. If upload fails, relay preserves the local file and reports the failure without crashing the session

## Storage Layout

```text
data/
  artifacts/
    <conversationId>/
      incoming/
      outgoing/
      meta.json
```

`meta.json` stores only lightweight metadata:

- `incoming[]`
- `outgoing[]`
- `lastUpdatedAt`

Each file record contains:

- `id`
- `sourceMessageId`
- `filename`
- `relativePath`
- `mimeType`
- `size`
- `kind`
- `sha256?`
- timestamps

## Artifact Protocol

Use a fenced code block named `artifacts` whose contents are JSON.

Example:

````markdown
```artifacts
{
  "files": [
    {
      "path": "reports/summary.md",
      "title": "Implementation Summary",
      "mimeType": "text/markdown"
    },
    {
      "path": "images/preview.png"
    }
  ]
}
```
````

Rules:

- Parse only the **last** valid `artifacts` block from the final answer
- Ignore entries whose `path` is missing, points to a directory, or escapes the allowed root
- Accept relative paths from the current working directory and conversation artifact directory
- If no valid block exists, do not upload guessed files automatically in v1

## Prompt Contract

Code-mode prompts get an injected instruction block:

- If attachments are present, tell the agent where they were saved
- If it wants files returned to the user, it must emit a final `artifacts` JSON block
- If no files should be returned, it should omit that block entirely

`/ask` gets attachment context for reading files, but does not advertise artifact upload support in v1.

## Error Handling

- Attachment download failure: continue with text prompt and warn which files were skipped
- Oversized attachment: skip the file and report the limit hit
- Invalid artifact path: ignore the entry and report a warning in the final response
- Missing artifact file: ignore and report
- Discord upload failure: keep local file, report failure
- Missing historical file during resume: warn, but continue the session

## Retention

Default to a mixed retention model:

- Keep recent conversation artifact directories for a configurable number of days
- Clean up old directories lazily on startup or before writes
- Allow session state to outlive missing files without fatal errors

## Testing Strategy

### Core

- conversation directory allocation
- metadata read/write
- retention cleanup
- artifact block parsing
- safe-path validation

### Discord

- attachment download + metadata creation
- prompt injection for `/code`, thread replies, and `/ask`
- outgoing artifact parsing and upload
- graceful handling of oversized files and upload failures

