import type { BackendName } from '../agent/backend.js';

export type ThreadNativeSessionStatus = 'pending' | 'confirmed' | 'invalid';

export interface ThreadSessionBinding {
  conversationId: string;
  backend: BackendName;
  nativeSessionId?: string;
  nativeSessionStatus: ThreadNativeSessionStatus;
  lastSeenAt: string;
  closedAt?: string;
}

export type ThreadContinuationStopReason = 'timeout' | 'interrupted' | 'error' | 'completed';

export interface ThreadContinuationSnapshot {
  conversationId: string;
  taskSummary: string;
  lastKnownCwd?: string;
  model?: string;
  effort?: string;
  whyStopped: ThreadContinuationStopReason;
  nextStep?: string;
  updatedAt: string;
}

export type ThreadResumeMode
  = { type: 'fresh-start' }
  | {
    type: 'native-resume';
    binding: ThreadSessionBinding;
    nativeSessionId: string;
  }
  | {
    type: 'snapshot-resume';
    binding: ThreadSessionBinding;
    snapshot: ThreadContinuationSnapshot;
  };
