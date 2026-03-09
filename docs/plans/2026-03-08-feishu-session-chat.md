# Feishu Session Chat Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Feishu private chats create dedicated bot-plus-user session groups, and use those groups as the Feishu equivalent of Discord threads.

**Architecture:** Keep the existing Feishu runtime and core orchestration for actual session execution, but split Feishu ingress into two paths: private-chat messages become a session-group creation flow, while messages inside bot-created session groups continue to run through the normal conversation pipeline keyed by the group `chat_id`.

**Tech Stack:** TypeScript, Node.js, `@larksuiteoapi/node-sdk`, existing `@agent-im-relay/core` session/runtime state, Vitest, tsdown

---

### Task 1: Add Feishu session-chat state and type surface

**Files:**
- Modify: `agent-im-relay/packages/feishu/src/config.ts`
- Create: `agent-im-relay/packages/feishu/src/session-chat.ts`
- Modify: `agent-im-relay/packages/feishu/src/index.ts`
- Create: `agent-im-relay/packages/feishu/src/__tests__/session-chat.test.ts`

**Step 1: Write the failing test**

Add tests for:

- building a session-chat record from a private-chat launch
- resolving whether an incoming Feishu chat is a private launcher chat or a session chat
- exporting the session-chat helpers from the package surface

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/session-chat.test.ts`
Expected: FAIL because session-chat state helpers do not exist yet.

**Step 3: Write minimal implementation**

- add a Feishu-owned session-chat mapping module
- keep the mapping small and explicit
- export the helpers needed by the runtime

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/session-chat.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/feishu/src/config.ts packages/feishu/src/session-chat.ts packages/feishu/src/index.ts packages/feishu/src/__tests__/session-chat.test.ts
git commit -m "feat(feishu): add session chat mapping state"
```

### Task 2: Extend the Feishu API client with session-group creation helpers

**Files:**
- Modify: `agent-im-relay/packages/feishu/src/api.ts`
- Modify: `agent-im-relay/packages/feishu/src/__tests__/api.test.ts`

**Step 1: Write the failing test**

Add tests for:

- creating a group chat with the bot and one target user
- posting a private-chat index message
- preserving the existing send-text/card/file helpers

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/api.test.ts`
Expected: FAIL because the Feishu client cannot create session groups yet.

**Step 3: Write minimal implementation**

- add an API helper to create the session group
- add any helper needed to address users by the correct Feishu identifier
- keep the current message-send helpers intact

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/api.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/feishu/src/api.ts packages/feishu/src/__tests__/api.test.ts
git commit -m "feat(feishu): add session group creation api"
```

### Task 3: Route private chats into session-group creation instead of direct runs

**Files:**
- Modify: `agent-im-relay/packages/feishu/src/events.ts`
- Modify: `agent-im-relay/packages/feishu/src/conversation.ts`
- Modify: `agent-im-relay/packages/feishu/src/__tests__/events.test.ts`
- Modify: `agent-im-relay/packages/feishu/src/__tests__/conversation.test.ts`

**Step 1: Write the failing test**

Add tests that assert:

- `p2p` messages create a session group instead of directly calling `runFeishuConversation()`
- the first run is executed against the created session group's `chat_id`
- the private chat receives an index message after creation

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/events.test.ts src/__tests__/conversation.test.ts`
Expected: FAIL because private chats still route directly into the conversation runner.

**Step 3: Write minimal implementation**

- split private-chat routing from session-group routing
- keep non-private follow-up handling keyed by `chat_id`
- ensure the initial prompt crosses into the new session group cleanly

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/events.test.ts src/__tests__/conversation.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/feishu/src/events.ts packages/feishu/src/conversation.ts packages/feishu/src/__tests__/events.test.ts packages/feishu/src/__tests__/conversation.test.ts
git commit -m "refactor(feishu): route private chats into session groups"
```

### Task 4: Keep session-group follow-ups and controls scoped to the created chat

**Files:**
- Modify: `agent-im-relay/packages/feishu/src/runtime.ts`
- Modify: `agent-im-relay/packages/feishu/src/cards.ts`
- Modify: `agent-im-relay/packages/feishu/src/__tests__/runtime.test.ts`
- Modify: `agent-im-relay/packages/feishu/src/__tests__/actions.test.ts`

**Step 1: Write the failing test**

Add tests that assert:

- follow-up messages in a created session group reuse the same `conversationId`
- backend/model/effort/done actions operate on the session group chat
- `/done` clears the session group continuation without deleting the private-chat index record

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/runtime.test.ts src/__tests__/actions.test.ts`
Expected: FAIL because current Feishu state still assumes direct-chat or reply-chain routing.

**Step 3: Write minimal implementation**

- scope runtime continuation to the session group `chat_id`
- keep card metadata aligned to the session group container
- do not let private-chat launcher state masquerade as the conversation session

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/runtime.test.ts src/__tests__/actions.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/feishu/src/runtime.ts packages/feishu/src/cards.ts packages/feishu/src/__tests__/runtime.test.ts packages/feishu/src/__tests__/actions.test.ts
git commit -m "feat(feishu): scope continuation to session groups"
```

### Task 5: Add failure handling and private-chat indexing behavior

**Files:**
- Modify: `agent-im-relay/packages/feishu/src/events.ts`
- Modify: `agent-im-relay/packages/feishu/src/session-chat.ts`
- Modify: `agent-im-relay/packages/feishu/src/__tests__/events.test.ts`
- Modify: `agent-im-relay/packages/feishu/src/__tests__/session-chat.test.ts`

**Step 1: Write the failing test**

Add tests that assert:

- group-creation failure returns a visible private-chat error
- index-message failure does not roll back the created session group
- the index record contains prompt preview, source chat, session chat, and creator

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/events.test.ts src/__tests__/session-chat.test.ts`
Expected: FAIL because failure handling and indexing are incomplete.

**Step 3: Write minimal implementation**

- persist the index mapping
- add clear private-chat error messages
- keep partial-failure behavior explicit and observable

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-im-relay/feishu test -- --run src/__tests__/events.test.ts src/__tests__/session-chat.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/feishu/src/events.ts packages/feishu/src/session-chat.ts packages/feishu/src/__tests__/events.test.ts packages/feishu/src/__tests__/session-chat.test.ts
git commit -m "feat(feishu): add private chat session indexing"
```

### Task 6: Verify the Feishu session-chat flow end to end

**Files:**
- Modify: `agent-im-relay/packages/feishu/package.json`

**Step 1: Run focused Feishu tests**

Run: `pnpm --filter @agent-im-relay/feishu test`
Expected: PASS.

**Step 2: Run core regression tests**

Run: `pnpm --filter @agent-im-relay/core test`
Expected: PASS.

**Step 3: Run build verification**

Run: `pnpm --filter @agent-im-relay/feishu build`
Expected: PASS.

**Step 4: Re-read the design and compare behavior**

Verify line by line that the implementation matches:

- private chat launches a fresh session group
- private chat gets an index message
- session group owns `conversationId`
- follow-ups stay inside the session group

**Step 5: Commit**

```bash
git add packages/feishu/package.json
git commit -m "test(feishu): verify session chat flow"
```
