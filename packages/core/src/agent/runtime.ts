import { streamAgentSession, type AgentSessionOptions, type AgentStreamEvent } from './session.js';
import type { AgentBackend, BackendName } from './backend.js';

type RuntimeSessionOptions = AgentSessionOptions & {
  backend?: BackendName | AgentBackend;
};

const activeControllers = new Map<string, AbortController>();

function mergeAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const available = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (available.length === 0) return undefined;
  if (available.length === 1) return available[0];

  const controller = new AbortController();
  const abort = () => {
    controller.abort();
    for (const signal of available) {
      signal.removeEventListener('abort', abort);
    }
  };

  for (const signal of available) {
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener('abort', abort, { once: true });
  }

  return controller.signal;
}

export function interruptConversationRun(conversationId: string): boolean {
  const controller = activeControllers.get(conversationId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function isConversationRunning(conversationId: string): boolean {
  return activeControllers.has(conversationId);
}

export function runConversationSession(
  conversationId: string,
  options: RuntimeSessionOptions,
): AsyncGenerator<AgentStreamEvent, void> {
  if (activeControllers.has(conversationId)) {
    throw new Error(`Conversation already running: ${conversationId}`);
  }

  const controller = new AbortController();
  const abortSignal = mergeAbortSignals(options.abortSignal, controller.signal);
  activeControllers.set(conversationId, controller);

  const { backend, ...sessionOptions } = options;

  const stream = typeof backend === 'object' && backend
    ? backend.stream({ ...sessionOptions, abortSignal })
    : streamAgentSession({ ...sessionOptions, backend, abortSignal });

  return (async function* (): AsyncGenerator<AgentStreamEvent, void> {
    try {
      yield* stream;
    } finally {
      if (activeControllers.get(conversationId) === controller) {
        activeControllers.delete(conversationId);
      }
    }
  })();
}

export function resetConversationRuntimeForTests(): void {
  for (const controller of activeControllers.values()) {
    controller.abort();
  }
  activeControllers.clear();
}
