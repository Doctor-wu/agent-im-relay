# Feishu Rich Text Rendering Design

**Context**

Feishu outbound text in `packages/feishu` currently sends plain `msg_type: "text"` payloads for all non-card messages. That keeps the transport simple, but long agent outputs collapse into a single dense text bubble where headings, lists, quotes, and inline identifiers have little visual separation. The screenshot attached to this task shows the current failure mode clearly: a multi-section explanation becomes hard to scan because paragraph structure is flattened and no Feishu-native rich text features are used.

The recent Feishu session presentation refactor also means the adapter now has a clearer separation between:

- text/file/card transport in `packages/feishu/src/events.ts`
- session control cards in `packages/feishu/src/cards.ts`
- agent output streaming in `packages/feishu/src/runtime.ts`

That makes this a good time to improve readability without changing shared `@agent-im-relay/core` semantics.

**Decision**

Keep the change scoped to `packages/feishu` and add a Feishu-specific rich-text formatting layer for outbound textual content.

The Feishu adapter will:

- introduce a formatter that treats all outbound textual content as rich-text candidates first
- send formatted long-form content through Feishu `msg_type: "post"`
- preserve existing card, file, and shared-chat message flows unchanged
- keep a narrow technical fallback to plain `text` only when the content is a bad fit for `post` or the formatter cannot build a safe payload

This preserves a single outbound text pipeline from the adapter point of view while keeping the last-resort downgrade needed for code blocks and oversized payloads.

**Why this shape**

- The readability problem is platform-specific, so the fix belongs in `packages/feishu`, not in shared core event models.
- Feishu `post` messages are the lightest native way to represent paragraph structure without conflating normal conversation replies with interactive cards.
- A formatter module keeps the transport change isolated and testable.
- A controlled downgrade path avoids making code-heavy answers worse just to preserve message-type uniformity.

**Outbound Formatting Rules**

All adapter-emitted textual content will go through a Feishu presentation formatter before send/reply.

The formatter will:

- normalize line endings and collapse accidental excessive blank lines
- split content into paragraph units using blank lines, quote blocks, list items, and heading-like lines
- preserve one paragraph per visible thought so long explanations no longer collapse into one wall of text
- keep list items on separate lines and normalize bullet prefixes for consistent scanning
- keep quotes visually grouped instead of merging them into adjacent paragraphs
- preserve inline identifiers such as file paths, field names, and commands as literal text

For heading-like content:

- markdown headings such as `# Summary` will be converted to standalone paragraphs with visible emphasis markers
- label-like lines such as `方案 A：` or `Design:` will also become standalone emphasized paragraphs when they clearly serve as section labels

**Fallback Rules**

The formatter should not force `post` when it would make the result worse or unsafe. It should fall back to plain `text` when:

- the content contains fenced code blocks
- the built `post` payload would exceed the chosen size budget
- the formatter cannot construct valid paragraph output from the source text

This is a transport-level downgrade only. The caller still uses one outbound text interface.

**Message Routing**

The runtime and event router should keep their existing semantics:

- environment summaries
- attachment receipts
- busy/error notices
- final agent output

All of them call the same `sendText()`-style transport entry point. The transport then decides whether the final Feishu payload is `post` or `text`.

This keeps the change from leaking into callers and avoids new branching inside `runtime.ts` or session-flow code.

**Files**

Expected implementation scope:

- modify `packages/feishu/src/api.ts`
- modify `packages/feishu/src/events.ts`
- create `packages/feishu/src/formatting.ts`
- add tests under `packages/feishu/src/__tests__`

`packages/feishu/src/events.ts` already has local uncommitted edits in this workspace, so the implementation must preserve those changes while integrating the new formatter.

**Testing**

Add focused regression coverage for:

- formatter output from long structured text into Feishu `post` payload paragraphs
- list, heading, quote, and inline-literal preservation
- code-fence fallback to plain `text`
- transport send/reply behavior choosing `post` by default and `text` on fallback
- end-to-end router/runtime behavior for a final long-form reply

The core package should remain untouched by this feature.
