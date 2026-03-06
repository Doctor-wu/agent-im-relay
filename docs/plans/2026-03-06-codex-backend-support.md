# Codex Backend Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add OpenAI Codex CLI as a parallel agent backend, letting users choose Claude or Codex per thread via an interactive Discord Select Menu when opening a new thread.

**Architecture:** Extract a `AgentBackend` interface in `core`, migrate Claude CLI logic to `backends/claude.ts`, add `backends/codex.ts` for Codex, and slim `session.ts` to a factory. Discord gains a thread-setup component (Select Menus + Start button) shown before each new conversation begins, plus state/persist support for `conversationBackend` and `savedCwdList`.

**Tech Stack:** TypeScript (ESM), discord.js v14, vitest, Node.js `child_process.spawn`

---

## Task 1: Define `AgentBackend` interface

**Files:**
- Create: `packages/core/src/agent/backend.ts`
- Create: `packages/core/src/agent/backends/` (directory only)

**Step 1: Create the interface file**

```typescript
// packages/core/src/agent/backend.ts
import type { AgentSessionOptions, AgentStreamEvent } from './session.js';

export type BackendName = 'claude' | 'codex';

export interface AgentBackend {
  readonly name: BackendName;
  stream(options: AgentSessionOptions): AsyncGenerator<AgentStreamEvent, void>;
}

const registry = new Map<BackendName, AgentBackend>();

export function registerBackend(backend: AgentBackend): void {
  registry.set(backend.name, backend);
}

export function getBackend(name: BackendName): AgentBackend {
  const backend = registry.get(name);
  if (!backend) throw new Error(`Unknown backend: ${name}`);
  return backend;
}
```

**Step 2: Create the backends directory**

```bash
mkdir -p packages/core/src/agent/backends
```

**Step 3: Commit**

```bash
git add packages/core/src/agent/backend.ts
git commit -m "feat(core): add AgentBackend interface and registry"
```

---

## Task 2: Migrate Claude logic to `backends/claude.ts`

**Files:**
- Create: `packages/core/src/agent/backends/claude.ts`
- Modify: `packages/core/src/agent/session.ts`

**Step 1: Create `backends/claude.ts`**

Copy the entire body of `packages/core/src/agent/session.ts` into `packages/core/src/agent/backends/claude.ts`, then wrap it in the `AgentBackend` interface:

```typescript
// packages/core/src/agent/backends/claude.ts
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { config } from '../../config.js';
import { toolsForMode } from '../tools.js';
import { registerBackend, type AgentBackend } from '../backend.js';
import type { AgentSessionOptions, AgentStreamEvent } from '../session.js';

// --- Keep all existing helper functions unchanged ---
// isRecord, asString, safeJson, formatToolSummary, extractContentEvents,
// extractDeltaEvents, extractStreamEvent, extractEvents, createClaudeArgs
// (copy them verbatim from session.ts)

async function* streamClaude(options: AgentSessionOptions): AsyncGenerator<AgentStreamEvent, void> {
  // Copy the entire streamAgentSession() body from session.ts verbatim,
  // replacing the function name and using config.claudeBin instead of CLAUDE_BIN
  const claudeBin = config.claudeBin;
  // ... rest of spawn logic unchanged ...
}

const claudeBackend: AgentBackend = {
  name: 'claude',
  stream: streamClaude,
};

registerBackend(claudeBackend);

export { claudeBackend, extractEvents, createClaudeArgs };
```

> **Key change:** replace hardcoded `'/opt/homebrew/bin/claude'` with `config.claudeBin` (added in Task 3).

**Step 2: Add `claudeBin` to `packages/core/src/config.ts`**

```typescript
export const config = {
  // ... existing fields ...
  claudeBin: process.env['CLAUDE_BIN']?.trim() || '/opt/homebrew/bin/claude',
  codexBin: process.env['CODEX_BIN']?.trim() || '/opt/homebrew/bin/codex',
};
```

**Step 3: Slim down `session.ts` to a factory**

Replace the full body of `session.ts` with:

```typescript
// packages/core/src/agent/session.ts
import './backends/claude.js'; // side-effect: registers claude backend
import './backends/codex.js';  // side-effect: registers codex backend
import { getBackend, type BackendName } from './backend.js';

export type { AgentStreamEvent, AgentSessionOptions } from './session-types.js';

export async function* streamAgentSession(
  options: AgentSessionOptions & { backend?: BackendName },
): AsyncGenerator<AgentStreamEvent, void> {
  const backend = getBackend(options.backend ?? 'claude');
  yield* backend.stream(options);
}
```

> Wait — `AgentStreamEvent` and `AgentSessionOptions` types are currently defined IN session.ts. We need to either keep them there or extract them. **Simplest approach:** keep the types in `session.ts` and import them in `backend.ts` and `backends/claude.ts`.

**Revised `session.ts`:**

```typescript
// packages/core/src/agent/session.ts
import './backends/claude.js';
import './backends/codex.js';
import { getBackend, type BackendName } from './backend.js';

export type AgentStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; summary: string }
  | { type: 'status'; status: string }
  | { type: 'done'; result: string; sessionId?: string }
  | { type: 'error'; error: string };

export type AgentSessionOptions = {
  mode: import('./tools.js').AgentMode;
  prompt: string;
  cwd?: string;
  model?: string;
  effort?: string;
  sessionId?: string;
  resumeSessionId?: string;
  abortSignal?: AbortSignal;
};

export async function* streamAgentSession(
  options: AgentSessionOptions & { backend?: BackendName },
): AsyncGenerator<AgentStreamEvent, void> {
  const backend = getBackend(options.backend ?? 'claude');
  yield* backend.stream(options);
}
```

**In `backends/claude.ts`**, import types from the parent:

```typescript
import type { AgentSessionOptions, AgentStreamEvent } from '../session.js';
```

**Step 4: Build to verify no TS errors**

```bash
cd packages/core && pnpm build
```

Expected: builds without errors.

**Step 5: Commit**

```bash
git add packages/core/src/agent/backend.ts \
        packages/core/src/agent/backends/claude.ts \
        packages/core/src/agent/session.ts \
        packages/core/src/config.ts
git commit -m "refactor(core): extract Claude CLI logic to backends/claude.ts"
```

---

## Task 3: Implement `backends/codex.ts`

**Files:**
- Create: `packages/core/src/agent/backends/codex.ts`
- Create: `packages/core/src/__tests__/backends/codex.test.ts`

**Step 1: Write failing tests**

```typescript
// packages/core/src/__tests__/backends/codex.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

// We'll mock child_process.spawn
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import type { AgentStreamEvent } from '../../agent/session.js';

async function collect(gen: AsyncGenerator<AgentStreamEvent>): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

function makeProcess(stdout: string, stderr = '', exitCode = 0) {
  const stdoutStream = Readable.from([stdout]);
  const stderrStream = Readable.from([stderr]);
  const proc = {
    stdout: stdoutStream,
    stderr: stderrStream,
    stdin: { write: vi.fn(), end: vi.fn() },
    killed: false,
    kill: vi.fn(),
    once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'close') setTimeout(() => cb(exitCode, null), 0);
    }),
  };
  return proc;
}

describe('codex backend', () => {
  beforeEach(() => vi.clearAllMocks());

  it('emits text events from plain text output', async () => {
    vi.mocked(spawn).mockReturnValue(makeProcess('Hello world\n') as any);

    const { codexBackend } = await import('../../agent/backends/codex.js');
    const events = await collect(codexBackend.stream({
      mode: 'code',
      prompt: 'test',
    }));

    expect(events.some(e => e.type === 'text')).toBe(true);
    expect(events.some(e => e.type === 'done')).toBe(true);
  });

  it('detects Working directory pattern', async () => {
    vi.mocked(spawn).mockReturnValue(
      makeProcess('Working directory: /home/user/project\nDone.\n') as any,
    );

    const { codexBackend } = await import('../../agent/backends/codex.js');
    const events = await collect(codexBackend.stream({ mode: 'code', prompt: 'test' }));

    const status = events.find(e => e.type === 'status' && e.status.startsWith('cwd:'));
    expect(status).toBeDefined();
    expect((status as any).status).toBe('cwd:/home/user/project');
  });

  it('emits error event on non-zero exit', async () => {
    vi.mocked(spawn).mockReturnValue(makeProcess('', 'command not found', 1) as any);

    const { codexBackend } = await import('../../agent/backends/codex.js');
    const events = await collect(codexBackend.stream({ mode: 'code', prompt: 'test' }));

    expect(events.some(e => e.type === 'error')).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/core && pnpm test src/__tests__/backends/codex.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement `backends/codex.ts`**

```typescript
// packages/core/src/agent/backends/codex.ts
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { config } from '../../config.js';
import { registerBackend, type AgentBackend } from '../backend.js';
import type { AgentSessionOptions, AgentStreamEvent } from '../session.js';

const WORKING_DIR_PATTERN = /^Working directory:\s*(.+)$/;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function* streamCodex(options: AgentSessionOptions): AsyncGenerator<AgentStreamEvent, void> {
  const cwd = options.cwd ?? config.claudeCwd;

  // Prepend find-directory instruction when no explicit cwd is provided
  const prompt = options.cwd
    ? options.prompt
    : `请在开始任务前，先找到与本任务相关的项目目录，并在响应的第一行输出：Working directory: /absolute/path，然后再执行任务。\n\n${options.prompt}`;

  const args = ['-q', prompt];
  if (options.model) args.unshift('--model', options.model);

  const child = spawn(config.codexBin, args, {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const closePromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    },
  );

  const stderrLines: string[] = [];
  let abortReason: 'timeout' | 'aborted' | null = null;

  const timeout = setTimeout(() => {
    abortReason = 'timeout';
    child.kill('SIGTERM');
  }, config.agentTimeoutMs);

  const onAbort = () => {
    abortReason = 'aborted';
    child.kill('SIGTERM');
  };

  if (options.abortSignal) {
    options.abortSignal.addEventListener('abort', onAbort);
    if (options.abortSignal.aborted) onAbort();
  }

  const stderrReader = child.stderr ? readline.createInterface({ input: child.stderr }) : null;
  stderrReader?.on('line', (line) => { if (line.trim()) stderrLines.push(line.trim()); });

  const stdoutReader = child.stdout ? readline.createInterface({ input: child.stdout }) : null;
  let fullOutput = '';

  try {
    if (!stdoutReader) throw new Error('Codex CLI stdout is unavailable');

    for await (const rawLine of stdoutReader) {
      const line = rawLine.trimEnd();
      if (!line) continue;

      fullOutput += line + '\n';

      // Detect working directory declaration
      const cwdMatch = WORKING_DIR_PATTERN.exec(line);
      if (cwdMatch?.[1]) {
        yield { type: 'status', status: `cwd:${cwdMatch[1].trim()}` };
      }

      // Try JSON parse (future-proofing if Codex adds JSON output)
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed['type'] === 'message' && typeof parsed['content'] === 'string') {
          yield { type: 'text', delta: parsed['content'] };
          continue;
        }
      } catch {
        // Not JSON — emit as plain text
      }

      yield { type: 'text', delta: line + '\n' };
    }

    const { code, signal } = await closePromise;

    if (abortReason === 'timeout') {
      yield { type: 'error', error: 'Agent request timed out' };
      return;
    }
    if (abortReason === 'aborted') {
      yield { type: 'error', error: 'Agent request aborted' };
      return;
    }
    if (code !== 0) {
      const details = stderrLines.join('\n').trim();
      const fallback = signal
        ? `Codex CLI exited with signal ${signal}`
        : `Codex CLI exited with code ${String(code)}`;
      yield { type: 'error', error: details || fallback };
      return;
    }

    yield { type: 'done', result: fullOutput.trim() };
  } catch (error) {
    if (abortReason === 'timeout') {
      yield { type: 'error', error: 'Agent request timed out' };
    } else if (abortReason === 'aborted') {
      yield { type: 'error', error: 'Agent request aborted' };
    } else {
      const details = stderrLines.join('\n').trim();
      yield { type: 'error', error: details || toErrorMessage(error) };
    }
  } finally {
    clearTimeout(timeout);
    stderrReader?.close();
    stdoutReader?.close();
    if (!child.killed) child.kill('SIGTERM');
    if (options.abortSignal) options.abortSignal.removeEventListener('abort', onAbort);
  }
}

export const codexBackend: AgentBackend = {
  name: 'codex',
  stream: streamCodex,
};

registerBackend(codexBackend);
```

**Step 4: Run tests to verify they pass**

```bash
cd packages/core && pnpm test src/__tests__/backends/codex.test.ts
```

Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add packages/core/src/agent/backends/codex.ts \
        packages/core/src/__tests__/backends/codex.test.ts
git commit -m "feat(core): implement Codex CLI backend adapter"
```

---

## Task 4: State + persist updates

**Files:**
- Modify: `packages/core/src/state.ts`
- Modify: `packages/core/src/persist.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Add new state to `state.ts`**

```typescript
// packages/core/src/state.ts — add these exports alongside existing ones:
import type { BackendName } from './agent/backend.js';

export const conversationBackend = new Map<string, BackendName>();
export const savedCwdList: string[] = [];

// Update initState and persistState:
export async function initState(): Promise<void> {
  await loadState(conversationSessions, conversationModels, conversationEffort, conversationCwd, conversationBackend, savedCwdList);
}

export async function persistState(): Promise<void> {
  await saveState(conversationSessions, conversationModels, conversationEffort, conversationCwd, conversationBackend, savedCwdList);
}
```

**Step 2: Update `persist.ts`**

Extend `PersistedState` interface and `loadState`/`saveState` signatures:

```typescript
interface PersistedState {
  sessions: Record<string, string>;
  models: Record<string, string>;
  effort: Record<string, string>;
  cwd: Record<string, string>;
  backend: Record<string, string>;   // new
  savedCwdList: string[];            // new
}

export async function loadState(
  sessions: Map<string, string>,
  models: Map<string, string>,
  effort: Map<string, string>,
  cwd: Map<string, string>,
  backend: Map<string, string>,      // new
  savedCwdList: string[],            // new
): Promise<void> {
  // ... existing populateMap calls ...
  populateMap(backend, parsed.backend ?? {});
  const cwds = Array.isArray(parsed.savedCwdList) ? parsed.savedCwdList : [];
  savedCwdList.push(...cwds.filter((v): v is string => typeof v === 'string'));
}

export async function saveState(
  sessions: Map<string, string>,
  models: Map<string, string>,
  effort: Map<string, string>,
  cwd: Map<string, string>,
  backend: Map<string, string>,      // new
  savedCwdList: string[],            // new
): Promise<void> {
  const data: PersistedState = {
    sessions: Object.fromEntries(sessions),
    models: Object.fromEntries(models),
    effort: Object.fromEntries(effort),
    cwd: Object.fromEntries(cwd),
    backend: Object.fromEntries(backend),  // new
    savedCwdList,                          // new
  };
  // ... rest unchanged ...
}
```

**Step 3: Export from `core/src/index.ts`**

Add to the State section:

```typescript
export {
  conversationSessions,
  conversationModels,
  conversationEffort,
  conversationCwd,
  conversationBackend,    // new
  savedCwdList,           // new
  activeConversations,
  processedMessages,
  pendingConversationCreation,
  initState,
  persistState,
} from './state.js';
```

Also export backend types:

```typescript
export type { BackendName, AgentBackend } from './agent/backend.js';
```

**Step 4: Build to verify**

```bash
cd packages/core && pnpm build
```

**Step 5: Commit**

```bash
git add packages/core/src/state.ts \
        packages/core/src/persist.ts \
        packages/core/src/index.ts
git commit -m "feat(core): add conversationBackend and savedCwdList state"
```

---

## Task 5: Discord — Thread setup UI component

**Files:**
- Create: `packages/discord/src/commands/thread-setup.ts`

This module builds and handles the interactive backend + cwd selection shown at the start of every new thread.

**Step 1: Create `thread-setup.ts`**

```typescript
// packages/discord/src/commands/thread-setup.ts
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type AnyThreadChannel,
  type MessageComponentInteraction,
} from 'discord.js';
import {
  conversationBackend,
  conversationCwd,
  savedCwdList,
  persistState,
  type BackendName,
} from '@agent-im-relay/core';

export const BACKEND_SELECT_ID = 'thread_setup:backend';
export const CWD_SELECT_ID = 'thread_setup:cwd';
export const START_BUTTON_ID = 'thread_setup:start';
export const AGENT_FIND_CWD = '__agent_find__';

export type SetupResult = {
  backend: BackendName;
  cwd: string | null; // null = agent finds it
};

function buildBackendMenu(): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(BACKEND_SELECT_ID)
      .setPlaceholder('选择 AI Backend')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('Claude (Claude Code)')
          .setValue('claude')
          .setDescription('Anthropic Claude Code CLI'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Codex (OpenAI Codex)')
          .setValue('codex')
          .setDescription('OpenAI Codex CLI'),
      ),
  );
}

function buildCwdMenu(): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = savedCwdList.map((dir) =>
    new StringSelectMenuOptionBuilder().setLabel(dir).setValue(dir),
  );
  options.push(
    new StringSelectMenuOptionBuilder()
      .setLabel('让 Agent 自己找')
      .setValue(AGENT_FIND_CWD)
      .setDescription('Agent 将自动定位项目目录'),
  );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CWD_SELECT_ID)
      .setPlaceholder('选择工作目录')
      .addOptions(options),
  );
}

function buildStartButton(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(START_BUTTON_ID)
      .setLabel('开始')
      .setStyle(ButtonStyle.Primary),
  );
}

const SETUP_TIMEOUT_MS = 60_000;

export async function promptThreadSetup(
  thread: AnyThreadChannel,
  prompt: string,
): Promise<SetupResult> {
  const msg = await thread.send({
    content: `**选择配置后点击「开始」**\n> ${prompt.slice(0, 200)}`,
    components: [buildBackendMenu(), buildCwdMenu(), buildStartButton()],
  });

  let selectedBackend: BackendName = 'claude';
  let selectedCwd: string | null = null;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      void msg.edit({ content: '⏰ 超时，使用默认配置：Claude + 让 Agent 自己找', components: [] });
      resolve({ backend: 'claude', cwd: null });
    }, SETUP_TIMEOUT_MS);

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: SETUP_TIMEOUT_MS,
    });

    const buttonCollector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (i: MessageComponentInteraction) => i.customId === START_BUTTON_ID,
      time: SETUP_TIMEOUT_MS,
    });

    collector.on('collect', async (interaction) => {
      await interaction.deferUpdate();
      if (interaction.customId === BACKEND_SELECT_ID) {
        selectedBackend = interaction.values[0] as BackendName;
      } else if (interaction.customId === CWD_SELECT_ID) {
        selectedCwd = interaction.values[0] === AGENT_FIND_CWD ? null : interaction.values[0];
      }
    });

    buttonCollector.on('collect', async (interaction) => {
      await interaction.deferUpdate();
      clearTimeout(timer);
      collector.stop();
      buttonCollector.stop();
      const cwdLabel = selectedCwd ?? '让 Agent 自己找';
      await msg.edit({
        content: `✅ Backend: **${selectedBackend}** | 工作目录: **${cwdLabel}**`,
        components: [],
      });
      resolve({ backend: selectedBackend, cwd: selectedCwd });
    });
  });
}

export async function applySetupResult(
  threadId: string,
  result: SetupResult,
): Promise<void> {
  conversationBackend.set(threadId, result.backend);
  if (result.cwd) {
    conversationCwd.set(threadId, result.cwd);
  }
  void persistState();
}
```

**Step 2: Build to verify**

```bash
cd packages/discord && pnpm build
```

**Step 3: Commit**

```bash
git add packages/discord/src/commands/thread-setup.ts
git commit -m "feat(discord): add thread setup UI for backend + cwd selection"
```

---

## Task 6: Wire thread setup into `index.ts`

**Files:**
- Modify: `packages/discord/src/index.ts`

**Step 1: Import thread-setup**

Add at the top of imports:

```typescript
import { promptThreadSetup, applySetupResult } from './commands/thread-setup.js';
```

**Step 2: Update `runMentionConversation` to read backend**

Change the `streamAgentSession` call to pass the backend:

```typescript
const events = streamAgentSession({
  mode: 'code',
  prompt,
  model: conversationModels.get(thread.id),
  effort: conversationEffort.get(thread.id),
  cwd: conversationCwd.get(thread.id) ?? config.claudeCwd,
  backend: conversationBackend.get(thread.id),   // ADD THIS
  ...(isResume
    ? { resumeSessionId: sessionId }
    : { sessionId }),
});
```

Also import `conversationBackend` from `@agent-im-relay/core`:

```typescript
import {
  // ... existing imports ...
  conversationBackend,  // ADD
} from '@agent-im-relay/core';
```

**Step 3: Add CWD auto-detection from stream events**

Inside `captureAgentEvents` or inline in the event capture block, scan for `status` events with `cwd:` prefix:

```typescript
captureAgentEvents(events, (event) => {
  // existing tool/done/error handling...

  // Auto-detect working directory from Codex output
  if (
    event.type === 'status' &&
    event.status.startsWith('cwd:') &&
    !conversationCwd.has(thread.id)
  ) {
    const detectedCwd = event.status.slice(4);
    conversationCwd.set(thread.id, detectedCwd);
    void offerSaveCwd(thread, detectedCwd);
  }
})
```

**Step 4: Add `offerSaveCwd` helper function** (in `index.ts` or extract to `commands/thread-setup.ts`)

```typescript
async function offerSaveCwd(thread: AnyThreadChannel, detectedPath: string): Promise<void> {
  if (savedCwdList.includes(detectedPath)) return;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`save_cwd:${detectedPath}`)
      .setLabel('保存到常用目录')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('save_cwd:ignore')
      .setLabel('忽略')
      .setStyle(ButtonStyle.Secondary),
  );

  const msg = await thread.send({
    content: `📁 Agent 确定工作目录：\`${detectedPath}\``,
    components: [row],
  });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60_000,
    max: 1,
  });

  collector.on('collect', async (interaction) => {
    await interaction.deferUpdate();
    if (interaction.customId.startsWith('save_cwd:') && !interaction.customId.endsWith(':ignore')) {
      savedCwdList.push(detectedPath);
      void persistState();
      await msg.edit({ content: `✅ 已保存：\`${detectedPath}\``, components: [] });
    } else {
      await msg.edit({ content: `📁 \`${detectedPath}\`（未保存）`, components: [] });
    }
  });

  collector.on('end', (_collected, reason) => {
    if (reason === 'time') {
      void msg.edit({ content: `📁 \`${detectedPath}\`（已超时）`, components: [] });
    }
  });
}
```

**Step 5: Show thread setup before first conversation**

In the `MessageCreate` handler, where `runMentionConversation` is called for a new thread, add setup step:

```typescript
// When creating a brand new thread (not resume):
const thread = await ensureMentionThread(message, prompt);
await thread.send(`**${message.author.displayName}:** ${prompt}`);

// Show setup UI only if backend not yet chosen
if (!conversationBackend.has(thread.id)) {
  const result = await promptThreadSetup(thread, prompt);
  await applySetupResult(thread.id, result);
}

await runMentionConversation(thread, prompt, message);
```

Also add same setup check in `handleCodeCommand` (in `commands/code.ts`).

**Step 6: Build to verify**

```bash
cd packages/discord && pnpm build
```

**Step 7: Commit**

```bash
git add packages/discord/src/index.ts
git commit -m "feat(discord): wire thread setup and backend selection into conversation flow"
```

---

## Task 7: Update `/cwd` command to support saved directories

**Files:**
- Modify: `packages/discord/src/commands/claude-control.ts`

The current `/cwd <path>` command sets the cwd for the current thread. We extend it with subcommands for managing `savedCwdList`.

**Step 1: Restructure `/cwd` as a subcommand group**

```typescript
// In claude-control.ts, replace existing cwdCommand with:
export const cwdCommand = new SlashCommandBuilder()
  .setName('cwd')
  .setDescription('工作目录管理')
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('set')
      .setDescription('设置当前 thread 的工作目录')
      .addStringOption((o) => o.setName('path').setDescription('绝对路径').setRequired(true)),
  )
  .addSubcommand((sub) => sub.setName('list').setDescription('列出常用目录'))
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('添加常用目录')
      .addStringOption((o) => o.setName('path').setDescription('绝对路径').setRequired(true)),
  )
  .addSubcommand((sub) => sub.setName('remove').setDescription('移除常用目录（交互式）'));
```

**Step 2: Update `handleCwdCommand` to dispatch subcommands**

```typescript
import { savedCwdList, persistState } from '@agent-im-relay/core';
import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ComponentType,
} from 'discord.js';

async function handleCwdCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === 'set') {
    const path = interaction.options.getString('path', true);
    if (!interaction.channel?.isThread()) {
      await interaction.reply({ content: 'This command only works inside a thread.', ephemeral: true });
      return;
    }
    conversationCwd.set(interaction.channel.id, path);
    void persistState();
    await interaction.reply({ content: `✅ 工作目录设置为：\`${path}\``, ephemeral: true });
    return;
  }

  if (sub === 'list') {
    const list = savedCwdList.length
      ? savedCwdList.map((d, i) => `${i + 1}. \`${d}\``).join('\n')
      : '（空）';
    await interaction.reply({ content: `**常用目录：**\n${list}`, ephemeral: true });
    return;
  }

  if (sub === 'add') {
    const path = interaction.options.getString('path', true);
    if (!savedCwdList.includes(path)) {
      savedCwdList.push(path);
      void persistState();
      await interaction.reply({ content: `✅ 已添加：\`${path}\``, ephemeral: true });
    } else {
      await interaction.reply({ content: `已存在：\`${path}\``, ephemeral: true });
    }
    return;
  }

  if (sub === 'remove') {
    if (savedCwdList.length === 0) {
      await interaction.reply({ content: '常用目录为空。', ephemeral: true });
      return;
    }
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('cwd_remove_select')
        .setPlaceholder('选择要移除的目录')
        .addOptions(savedCwdList.map((d) => new StringSelectMenuOptionBuilder().setLabel(d).setValue(d))),
    );
    await interaction.reply({ content: '选择要移除的目录：', components: [row], ephemeral: true });

    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 30_000, max: 1 });
    collector.on('collect', async (i) => {
      const toRemove = i.values[0];
      const idx = savedCwdList.indexOf(toRemove);
      if (idx !== -1) savedCwdList.splice(idx, 1);
      void persistState();
      await i.update({ content: `✅ 已移除：\`${toRemove}\``, components: [] });
    });
    return;
  }
}
```

**Step 3: Build to verify**

```bash
cd packages/discord && pnpm build
```

**Step 4: Commit**

```bash
git add packages/discord/src/commands/claude-control.ts
git commit -m "feat(discord): extend /cwd command with list/add/remove subcommands"
```

---

## Task 8: Export `BackendName` from core + update `.env.example`

**Files:**
- Modify: `packages/core/src/index.ts` (verify export added in Task 4)
- Modify: `.env.example` (root level)

**Step 1: Verify exports in `core/src/index.ts`**

Ensure these are present (added in Task 4):

```typescript
export type { BackendName, AgentBackend } from './agent/backend.js';
```

**Step 2: Update `.env.example`**

```bash
# Add to .env.example:
CLAUDE_BIN=/opt/homebrew/bin/claude
CODEX_BIN=/opt/homebrew/bin/codex
```

**Step 3: Commit**

```bash
git add .env.example
git commit -m "chore: add CLAUDE_BIN and CODEX_BIN to .env.example"
```

---

## Task 9: Final build + integration smoke test

**Step 1: Full monorepo build**

```bash
cd /path/to/agent-im-relay && pnpm build
```

Expected: no TS errors in core or discord packages.

**Step 2: Run all tests**

```bash
pnpm test
```

Expected: all tests pass.

**Step 3: Start bot in dev mode and manually verify**

```bash
pnpm dev:discord
```

Verify in Discord:
1. @mention bot in a channel → thread created → setup message appears with two Select Menus and Start button
2. Select Codex + 让 Agent 自己找 → click Start → agent runs
3. If agent outputs `Working directory: /some/path` → follow-up "Save?" button appears
4. `/cwd list` → shows saved dirs
5. `/cwd add /some/path` → adds to list
6. Next thread creation → saved path appears in CWD select menu

**Step 4: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore: finalize codex backend support"
```
