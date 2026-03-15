import {
  buildAgentPrompt,
  streamAgentSession,
  type AgentSessionOptions,
  type AgentStreamEvent,
} from './session';
import type { AgentBackend, BackendName } from './backend';
import { maybeUnrefTimer } from '../runtime/timers';

type RuntimeSessionOptions = AgentSessionOptions & {
  backend?: BackendName | AgentBackend;
};

const activeControllers = new Map<string, AbortController>();
type PermissionDecision = 'approved' | 'denied';
type PermissionResolutionDecision = PermissionDecision | 'timeout';

type PermissionResponder = {
  backend: string;
  respond(requestId: string, decision: PermissionDecision): void;
};

export type PendingPermissionRequest = {
  conversationId: string;
  requestId: string;
  backend: string;
  tool?: string;
  reason?: string;
  expiresAt: string;
};

type PendingPermissionEntry = {
  request: PendingPermissionRequest;
  timer: ReturnType<typeof setTimeout>;
};

type ConversationPermissionState = {
  responder?: PermissionResponder;
  requests: Map<string, PendingPermissionEntry>;
  queuedEvents: AgentStreamEvent[];
  waiters: Array<(event: AgentStreamEvent | null) => void>;
};

const permissionState = new Map<string, ConversationPermissionState>();

function getOrCreatePermissionState(conversationId: string): ConversationPermissionState {
  let state = permissionState.get(conversationId);
  if (!state) {
    state = {
      requests: new Map<string, PendingPermissionEntry>(),
      queuedEvents: [],
      waiters: [],
    };
    permissionState.set(conversationId, state);
  }
  return state;
}

function clearPermissionRequest(
  conversationId: string,
  requestId: string,
): PendingPermissionRequest | undefined {
  const state = permissionState.get(conversationId);
  const entry = state?.requests.get(requestId);
  if (!entry) {
    return undefined;
  }

  clearTimeout(entry.timer);
  state!.requests.delete(requestId);
  return entry.request;
}

function pushPermissionEvent(conversationId: string, event: AgentStreamEvent): void {
  const state = getOrCreatePermissionState(conversationId);
  const waiter = state.waiters.shift();
  if (waiter) {
    waiter(event);
    return;
  }

  state.queuedEvents.push(event);
}

function shiftQueuedPermissionEvent(conversationId: string): AgentStreamEvent | undefined {
  return permissionState.get(conversationId)?.queuedEvents.shift();
}

function waitForPermissionEvent(conversationId: string): Promise<AgentStreamEvent | null> {
  const queued = shiftQueuedPermissionEvent(conversationId);
  if (queued) {
    return Promise.resolve(queued);
  }

  return new Promise((resolve) => {
    getOrCreatePermissionState(conversationId).waiters.push(resolve);
  });
}

function resolvePermissionRequestInternal(options: {
  conversationId: string;
  requestId: string;
  decision: PermissionResolutionDecision;
}): {
  requestId: string;
  backend: string;
  decision: PermissionResolutionDecision;
} {
  const request = clearPermissionRequest(options.conversationId, options.requestId);
  if (!request) {
    throw new Error(`Permission request is not pending: ${options.requestId}`);
  }

  const state = permissionState.get(options.conversationId);
  const responder = state?.responder;
  if (!responder) {
    throw new Error(`No permission responder registered for conversation: ${options.conversationId}`);
  }

  responder.respond(
    options.requestId,
    options.decision === 'approved' ? 'approved' : 'denied',
  );

  pushPermissionEvent(options.conversationId, {
    type: 'permission-resolved',
    requestId: request.requestId,
    backend: request.backend,
    decision: options.decision,
  });

  return {
    requestId: request.requestId,
    backend: request.backend,
    decision: options.decision,
  };
}

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

export function registerConversationPermissionResponder(
  conversationId: string,
  responder: PermissionResponder,
): void {
  const state = getOrCreatePermissionState(conversationId);
  state.responder = responder;
}

export function registerPermissionRequest(options: {
  conversationId: string;
  requestId: string;
  backend: string;
  tool?: string;
  reason?: string;
  timeoutMs: number;
}): PendingPermissionRequest {
  const state = getOrCreatePermissionState(options.conversationId);
  if (!state.responder) {
    throw new Error(`No permission responder registered for conversation: ${options.conversationId}`);
  }

  clearPermissionRequest(options.conversationId, options.requestId);

  const expiresAt = new Date(Date.now() + options.timeoutMs).toISOString();
  const request: PendingPermissionRequest = {
    conversationId: options.conversationId,
    requestId: options.requestId,
    backend: options.backend,
    tool: options.tool,
    reason: options.reason,
    expiresAt,
  };
  const timer = setTimeout(() => {
    resolvePermissionRequestInternal({
      conversationId: options.conversationId,
      requestId: options.requestId,
      decision: 'timeout',
    });
  }, options.timeoutMs);
  maybeUnrefTimer(timer);
  state.requests.set(options.requestId, { request, timer });
  return request;
}

export function getPendingPermissionRequests(conversationId: string): PendingPermissionRequest[] {
  return [...(permissionState.get(conversationId)?.requests.values() ?? [])]
    .map(entry => entry.request);
}

export function resolvePermissionRequest(options: {
  conversationId: string;
  requestId: string;
  decision: PermissionDecision;
}): {
  requestId: string;
  backend: string;
  decision: PermissionResolutionDecision;
} {
  return resolvePermissionRequestInternal(options);
}

export function clearConversationPermissionState(conversationId: string): void {
  const state = permissionState.get(conversationId);
  if (!state) {
    return;
  }

  for (const entry of state.requests.values()) {
    clearTimeout(entry.timer);
  }
  for (const waiter of state.waiters) {
    waiter(null);
  }
  permissionState.delete(conversationId);
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
  const prompt = buildAgentPrompt(sessionOptions);

  const stream = typeof backend === 'object' && backend
    ? backend.stream({ ...sessionOptions, conversationId, prompt, abortSignal })
    : streamAgentSession({ ...sessionOptions, conversationId, prompt, backend, abortSignal });

  return (async function* (): AsyncGenerator<AgentStreamEvent, void> {
    const iterator = stream[Symbol.asyncIterator]();
    let nextStreamEvent = iterator.next();
    let nextPermissionEvent = waitForPermissionEvent(conversationId);

    try {
      while (true) {
        const winner = await Promise.race([
          nextStreamEvent.then(result => ({ kind: 'stream' as const, result })),
          nextPermissionEvent.then(event => ({ kind: 'permission' as const, event })),
        ]);

        if (winner.kind === 'permission') {
          if (winner.event) {
            yield winner.event;
            nextPermissionEvent = waitForPermissionEvent(conversationId);
          }
          continue;
        }

        if (winner.result.done) {
          let queued = shiftQueuedPermissionEvent(conversationId);
          while (queued) {
            yield queued;
            queued = shiftQueuedPermissionEvent(conversationId);
          }
          return;
        }

        yield winner.result.value;
        nextStreamEvent = iterator.next();
      }
    } finally {
      clearConversationPermissionState(conversationId);
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
  for (const state of permissionState.values()) {
    for (const entry of state.requests.values()) {
      clearTimeout(entry.timer);
    }
  }
  permissionState.clear();
}
