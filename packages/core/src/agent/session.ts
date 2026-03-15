import './backends/claude';
import './backends/codex';
import './backends/opencode';
import { getBackend, type BackendName } from './backend';
import type { AgentMode } from './tools';

export type AgentStreamEvent =
  | { type: 'environment'; environment: AgentEnvironment }
  | { type: 'session'; sessionId: string; status: 'confirmed' | 'resumed' }
  | { type: 'session-invalidated'; sessionId?: string; reason: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; summary: string }
  | {
    type: 'permission-requested';
    requestId: string;
    backend: string;
    tool?: string;
    reason?: string;
    expiresAt: string;
  }
  | {
    type: 'permission-resolved';
    requestId: string;
    backend: string;
    decision: 'approved' | 'denied' | 'timeout';
  }
  | { type: 'status'; status: string }
  | { type: 'done'; result: string; sessionId?: string }
  | { type: 'error'; error: string };

export type AgentEnvironment = {
  backend: import('./backend').BackendName;
  mode: import('./tools').AgentMode;
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
  conversationId?: string;
  mode: AgentMode;
  prompt: string;
  cwd?: string;
  model?: string;
  effort?: string;
  sessionId?: string;
  resumeSessionId?: string;
  abortSignal?: AbortSignal;
};

const CODE_ARTIFACT_MANIFEST_INSTRUCTIONS = [
  'If you create files that should be returned to the user, end your final response with a fenced `artifacts` JSON block.',
  'Use this exact shape:',
  '```artifacts',
  '{"files":[{"path":"relative/path.ext","title":"Optional title","mimeType":"optional/type"}]}',
  '```',
  'Only include files that already exist and are safe to share. Omit the block when there are no files to return.',
].join('\n');

export function buildAgentPrompt(options: Pick<AgentSessionOptions, 'mode' | 'prompt'>): string {
  if (options.mode !== 'code' || options.prompt.includes('```artifacts')) {
    return options.prompt;
  }

  return `${options.prompt}\n\n${CODE_ARTIFACT_MANIFEST_INSTRUCTIONS}`;
}

export async function* streamAgentSession(
  options: AgentSessionOptions & { backend?: BackendName },
): AsyncGenerator<AgentStreamEvent, void> {
  const backend = getBackend(options.backend ?? 'claude');
  if (!(await backend.isAvailable())) {
    yield { type: 'error', error: `Backend not available: ${backend.name}` };
    return;
  }
  yield* backend.stream({
    ...options,
    prompt: buildAgentPrompt(options),
  });
}

// Re-export helpers for backward compatibility
export { extractEvents, createClaudeArgs } from './backends/claude';
