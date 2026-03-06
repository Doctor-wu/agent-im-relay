import './backends/claude.js';
import './backends/codex.js';
import { getBackend, type BackendName } from './backend.js';

export type AgentStreamEvent =
  | { type: 'environment'; environment: AgentEnvironment }
  | { type: 'text'; delta: string }
  | { type: 'tool'; summary: string }
  | { type: 'status'; status: string }
  | { type: 'done'; result: string; sessionId?: string }
  | { type: 'error'; error: string };

export type AgentEnvironment = {
  backend: import('./backend.js').BackendName;
  mode: import('./tools.js').AgentMode;
  model: {
    requested?: string;
    resolved?: string;
  };
  cwd: {
    value?: string;
    source: 'explicit' | 'auto-detected' | 'default' | 'unknown';
  };
  git: {
    isRepo: boolean;
    branch?: string;
    repoRoot?: string;
  };
};

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

// Re-export helpers for backward compatibility
export { extractEvents, createClaudeArgs } from './backends/claude.js';
