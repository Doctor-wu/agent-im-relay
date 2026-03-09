const mirroredMessageIds = new Set<string>();
const dispatchEmissions = new Map<string, Set<FeishuDispatchMessageKind>>();

export type FeishuDispatchMessageKind =
  | 'interrupt-card'
  | 'busy'
  | 'final-output';

export function rememberMirroredFeishuMessageId(messageId: string): void {
  if (!messageId) {
    return;
  }

  mirroredMessageIds.add(messageId);
}

export function consumeMirroredFeishuMessageId(messageId: string): boolean {
  if (!mirroredMessageIds.has(messageId)) {
    return false;
  }

  mirroredMessageIds.delete(messageId);
  return true;
}

export function beginFeishuDispatch(sourceMessageId: string): {
  dispatchId: string;
} {
  if (!dispatchEmissions.has(sourceMessageId)) {
    dispatchEmissions.set(sourceMessageId, new Set());
  }

  return {
    dispatchId: sourceMessageId,
  };
}

export function markFeishuDispatchMessageEmitted(
  dispatchId: string,
  kind: FeishuDispatchMessageKind,
): boolean {
  const emittedKinds = dispatchEmissions.get(dispatchId) ?? new Set<FeishuDispatchMessageKind>();
  if (emittedKinds.has(kind)) {
    return false;
  }

  emittedKinds.add(kind);
  dispatchEmissions.set(dispatchId, emittedKinds);
  return true;
}

export function resetFeishuLaunchStateForTests(): void {
  mirroredMessageIds.clear();
  dispatchEmissions.clear();
}
