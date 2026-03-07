# Feishu Managed Gateway Architecture

## Overall Architecture

```text
┌──────────────┐
│ Feishu User  │
└──────┬───────┘
       │ send message / click card / upload file
       ▼
┌───────────────────────────────┐
│ Managed Gateway               │
│                               │
│ 1. Receive Feishu callbacks   │
│ 2. Validate requests          │
│ 3. Route by conversation      │
│ 4. Keep card/pending context  │
│ 5. Send text/card/file back   │
└──────┬────────────────────────┘
       │ outbound bridge only
       ▼
┌───────────────────────────────┐
│ Local Relay Client            │
│                               │
│ 1. Connect to gateway         │
│ 2. Pull pending work          │
│ 3. Execute local actions      │
│ 4. Stream text/card/file out  │
└──────┬────────────────────────┘
       │ invoke local runtime
       ▼
┌───────────────────────────────┐
│ Local Execution Core          │
│                               │
│ 1. Conversation orchestration │
│ 2. Session state              │
│ 3. Attachment handling        │
│ 4. Artifact generation        │
│ 5. Tool/model execution       │
└───────────────────────────────┘
```

## Message Flow

```text
User            Feishu         Managed Gateway     Local Relay Client     Local Execution
 |                |                   |                     |                    |
 |--message------>|                   |                     |                    |
 |                |--callback-------->|                     |                    |
 |                |                   |--bridge request---->|                    |
 |                |                   |                     |--run locally------>|
 |                |                   |                     |<--text/file/card---|
 |                |                   |<--result stream-----|                    |
 |                |<--send reply------|                     |                    |
 |<--see result---|                   |                     |                    |
```

## Card Interaction Flow

```text
User clicks card
      │
      ▼
    Feishu
      │ callback
      ▼
Managed Gateway
      │
      ├─ handle directly if no local execution is needed
      │
      └─ forward to Local Relay Client if local state or execution is needed
                    │
                    ▼
              Local Execution
                    │
                    ▼
              result back to gateway
                    │
                    ▼
           gateway updates Feishu card or message
```

## Key Boundary

- Public callback ownership lives in the managed gateway.
- Local execution, working directory, attachments, artifacts, and runtime stay on the user's machine.
- The user machine never needs public inbound network access.
