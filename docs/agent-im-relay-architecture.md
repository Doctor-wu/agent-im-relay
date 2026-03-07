# agent-im-relay Architecture

`agent-im-relay` is organized as a pnpm monorepo with a platform-specific delivery layer and a platform-agnostic core runtime.

## Architecture Summary

- `@agent-im-relay/discord` owns Discord UX: slash commands, thread lifecycle, live streaming edits, reaction status, attachment ingress, and returned file upload.
- `@agent-im-relay/core` owns the reusable runtime: session startup, interruption, backend abstraction, state maps, artifact protocol, and persistence.
- Claude and Codex plug into the same backend stream contract, so the Discord package does not care which backend is active once the run starts.
- Future IM platforms can add new adapter packages while reusing the same core runtime and artifact/state protocol.

## Mermaid Diagram

```mermaid
%%{init: {"flowchart": {"nodeSpacing": 36, "rankSpacing": 54}} }%%
flowchart TB
    user["Discord user<br/>slash commands / thread replies"]
    thread["Discord thread<br/>conversation boundary"]

    subgraph discord["@agent-im-relay/discord"]
      commands["commands/*.ts + thread.ts<br/>entry and thread setup"]
      runner["runMentionConversation()<br/>resume session, cwd, backend"]
      ingress["prepareAttachmentPrompt()<br/>download and summarize attachments"]
      stream["streamAgentToDiscord()<br/>message edits and reactions"]
      upload["publishConversationArtifacts()<br/>upload returned files"]
    end

    subgraph core["@agent-im-relay/core"]
      runtime["runConversationSession()<br/>interruptConversationRun()"]
      prompt["buildAgentPrompt()<br/>artifact contract injection"]
      registry["backend registry<br/>Claude | Codex"]
      state["conversation state maps<br/>session/model/effort/cwd/backend"]
      artifacts["artifact store + protocol<br/>incoming/outgoing/meta.json"]
      contracts["capability interfaces<br/>PlatformAdapter and formatters"]
    end

    subgraph backends["Agent backends"]
      claude["Claude backend"]
      codex["Codex backend"]
    end

    subgraph storage["Persisted storage"]
      sessions["data/sessions.json"]
      files["data/artifacts/<conversationId>/"]
    end

    future["Future adapters<br/>Slack / Telegram / Feishu"]

    user --> thread --> commands --> runner
    runner --> ingress
    runner --> runtime
    ingress -. "incoming files" .-> artifacts
    runtime --> prompt --> registry
    registry --> claude
    registry --> codex
    claude --> stream
    codex --> stream
    stream --> thread
    stream --> upload
    upload -. "outgoing files" .-> artifacts
    state --> sessions
    artifacts --> files
    future -. "same core boundary" .-> contracts
    contracts --> runner
```

## Runtime Flow

1. A Discord command or thread reply enters the Discord package and is mapped to a thread-scoped conversation.
2. `runMentionConversation()` restores session context and prepares the run configuration.
3. `prepareAttachmentPrompt()` downloads incoming files into `data/artifacts/<conversationId>/incoming/` and prepends local-path context to the prompt.
4. `runConversationSession()` in core builds the final prompt, selects the backend, and opens the event stream.
5. The active backend emits environment, status, tool, text, done, and error events through a shared stream contract.
6. `streamAgentToDiscord()` converts the stream into Discord message edits, environment summaries, and reaction status updates.
7. If the final answer includes an `artifacts` fenced block, the protocol validates file paths, copies approved files to `outgoing/`, and the Discord package uploads them back into the thread.

## Why This Layout Works

- The Discord package stays thin on agent logic and heavy on transport concerns.
- The core package centralizes concurrency, session continuity, backend switching, and artifact safety.
- Adding another IM platform mostly means implementing a new adapter package rather than rewriting session orchestration.
