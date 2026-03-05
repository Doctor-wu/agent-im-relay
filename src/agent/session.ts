import { query, type Options, type Query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config.js';
import { toolsForMode, type AgentMode } from './tools.js';

type TextDeltaEvent = {
  type?: string;
  delta?: {
    type?: string;
    text?: string;
  };
  content_block?: {
    type?: string;
    name?: string;
    input?: unknown;
  };
};

export type AgentStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; summary: string }
  | { type: 'status'; status: string }
  | { type: 'done'; result: string }
  | { type: 'error'; error: string };

export type AgentSessionOptions = {
  mode: AgentMode;
  prompt: string;
  cwd?: string;
  abortSignal?: AbortSignal;
};

function createAgentOptions(mode: AgentMode, cwd: string | undefined, abortController: AbortController): Options {
  return {
    abortController,
    cwd,
    includePartialMessages: true,
    maxThinkingTokens: config.maxTokens,
    maxTurns: config.maxTurns,
    model: config.claudeModel,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: config.anthropicApiKey,
      ...(config.anthropicBaseUrl ? { ANTHROPIC_BASE_URL: config.anthropicBaseUrl } : {}),
    },
    tools: toolsForMode(mode),
  };
}

function extractTextDelta(message: SDKMessage): string | null {
  if (message.type !== 'stream_event') return null;

  const event = message.event as TextDeltaEvent;
  if (event.type !== 'content_block_delta') return null;
  if (event.delta?.type !== 'text_delta') return null;
  if (typeof event.delta.text !== 'string') return null;

  return event.delta.text;
}

function extractToolStart(message: SDKMessage): string | null {
  if (message.type !== 'stream_event') return null;

  const event = message.event as TextDeltaEvent;
  if (event.type !== 'content_block_start') return null;
  if (event.content_block?.type !== 'tool_use') return null;
  if (typeof event.content_block.name !== 'string') return null;

  const input =
    event.content_block.input === undefined
      ? ''
      : ` ${JSON.stringify(event.content_block.input).slice(0, 600)}`;

  return `${event.content_block.name}${input}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function* streamAgentSession(options: AgentSessionOptions): AsyncGenerator<AgentStreamEvent, void> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), config.agentTimeoutMs);
  const onAbort = () => abortController.abort();
  let stream: Query | null = null;

  if (options.abortSignal) {
    options.abortSignal.addEventListener('abort', onAbort);
  }

  try {
    stream = query({
      prompt: options.prompt,
      options: createAgentOptions(options.mode, options.cwd, abortController),
    });

    for await (const message of stream) {
      const delta = extractTextDelta(message);
      if (delta) {
        yield { type: 'text', delta };
        continue;
      }

      const toolStart = extractToolStart(message);
      if (toolStart) {
        yield { type: 'tool', summary: `running ${toolStart}` };
        continue;
      }

      if (message.type === 'tool_use_summary') {
        yield { type: 'tool', summary: message.summary };
        continue;
      }

      if (message.type === 'system' && message.subtype === 'status' && message.status) {
        yield { type: 'status', status: message.status };
        continue;
      }

      if (message.type === 'result') {
        if (message.subtype === 'success') {
          yield { type: 'done', result: message.result };
        } else {
          const summary = message.errors.join('\n').trim();
          yield { type: 'error', error: summary || 'Agent execution failed' };
        }
      }
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      yield { type: 'error', error: 'Agent request timed out' };
    } else {
      yield { type: 'error', error: toErrorMessage(error) };
    }
  } finally {
    clearTimeout(timeout);
    if (options.abortSignal) {
      options.abortSignal.removeEventListener('abort', onAbort);
    }
    stream?.close();
  }
}
