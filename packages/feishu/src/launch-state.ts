const mirroredMessageIds = new Set<string>();
const dispatchEmissions = new Map<string, Set<FeishuDispatchMessageKind>>();
const FEISHU_DISPATCH_EMISSION_LIMIT = 1000;

export type FeishuDispatchMessageKind =
  | 'interrupt-card'
  | 'busy'
  | 'final-output'
  | 'error-output';

function rememberDispatchEmissionState(
  dispatchId: string,
  emittedKinds: Set<FeishuDispatchMessageKind>,
): void {
  if (dispatchEmissions.has(dispatchId)) {
    dispatchEmissions.delete(dispatchId);
  }

  dispatchEmissions.set(dispatchId, emittedKinds);

  while (dispatchEmissions.size > FEISHU_DISPATCH_EMISSION_LIMIT) {
    const oldestDispatchId = dispatchEmissions.keys().next().value;
    if (!oldestDispatchId) {
      break;
    }

    dispatchEmissions.delete(oldestDispatchId);
  }
}

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
  rememberDispatchEmissionState(
    sourceMessageId,
    dispatchEmissions.get(sourceMessageId) ?? new Set(),
  );

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
  rememberDispatchEmissionState(dispatchId, emittedKinds);
  return true;
}

export function resetFeishuLaunchStateForTests(): void {
  mirroredMessageIds.clear();
  dispatchEmissions.clear();
}
