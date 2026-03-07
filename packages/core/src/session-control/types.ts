import type { BackendName } from '../agent/backend.js';

export type SessionControlCommand =
  | { conversationId: string; type: 'interrupt' }
  | { conversationId: string; type: 'done' }
  | { conversationId: string; type: 'backend'; value: BackendName }
  | { conversationId: string; type: 'confirm-backend'; value: BackendName }
  | { conversationId: string; type: 'cancel-backend' }
  | { conversationId: string; type: 'model'; value: string }
  | { conversationId: string; type: 'effort'; value: string };

type SessionControlResultBase = {
  conversationId: string;
  stateChanged: boolean;
  persist: boolean;
  clearContinuation: boolean;
  requiresConfirmation: boolean;
  summaryKey:
    | 'interrupt.noop'
    | 'interrupt.ok'
    | 'done.noop'
    | 'done.ok'
    | 'backend.confirm'
    | 'backend.updated'
    | 'backend.cancelled'
    | 'backend.cancelled-noop'
    | 'model.updated'
    | 'model.noop'
    | 'effort.updated'
    | 'effort.noop';
};

export type SessionControlResult =
  | (SessionControlResultBase & {
    kind: 'interrupt';
    interrupted: boolean;
  })
  | (SessionControlResultBase & {
    kind: 'done';
  })
  | (SessionControlResultBase & {
    kind: 'backend';
    backend?: BackendName;
    currentBackend?: BackendName;
    requestedBackend?: BackendName;
  })
  | (SessionControlResultBase & {
    kind: 'confirm-backend';
    backend: BackendName;
  })
  | (SessionControlResultBase & {
    kind: 'cancel-backend';
  })
  | (SessionControlResultBase & {
    kind: 'model';
    value: string;
  })
  | (SessionControlResultBase & {
    kind: 'effort';
    value: string;
  });
