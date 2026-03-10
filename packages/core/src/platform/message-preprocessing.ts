import type { BackendName } from '../agent/backend.js';
import { applySessionControlCommand } from '../session-control/controller.js';
import type { SessionControlResult } from '../session-control/types.js';

export type MessageControlDirective = {
  type: 'backend';
  value: BackendName;
};

export type PreprocessedConversationMessage = {
  prompt: string;
  directives: MessageControlDirective[];
};

type DirectiveOccurrence = {
  start: number;
  end: number;
  directive: MessageControlDirective;
};

type ParsedDirectiveCandidate =
  | {
    kind: 'valid';
    occurrence: DirectiveOccurrence;
    nextSearchIndex: number;
  }
  | {
    kind: 'skip';
    nextSearchIndex: number;
  };

const OPEN_TAG = '<set-backend>';
const CLOSE_TAG = '</set-backend>';
const VALID_BACKENDS = new Set<BackendName>(['claude', 'codex']);

function parseDirectiveCandidate(content: string, openIndex: number): ParsedDirectiveCandidate {
  let cursor = openIndex + OPEN_TAG.length;
  let closeIndex = -1;
  let depth = 1;

  while (depth > 0) {
    const nextOpen = content.indexOf(OPEN_TAG, cursor);
    const nextClose = content.indexOf(CLOSE_TAG, cursor);

    if (nextClose === -1) {
      return {
        kind: 'skip',
        nextSearchIndex: openIndex + OPEN_TAG.length,
      };
    }

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      cursor = nextOpen + OPEN_TAG.length;
      continue;
    }

    depth -= 1;
    closeIndex = nextClose;
    cursor = nextClose + CLOSE_TAG.length;
  }

  const innerContent = content.slice(openIndex + OPEN_TAG.length, closeIndex);
  if (innerContent.includes(OPEN_TAG) || innerContent.includes(CLOSE_TAG)) {
    return {
      kind: 'skip',
      nextSearchIndex: cursor,
    };
  }

  const backend = innerContent.trim().toLowerCase() as BackendName;
  if (!VALID_BACKENDS.has(backend)) {
    return {
      kind: 'skip',
      nextSearchIndex: cursor,
    };
  }

  return {
    kind: 'valid',
    occurrence: {
      start: openIndex,
      end: cursor,
      directive: {
        type: 'backend',
        value: backend,
      },
    },
    nextSearchIndex: cursor,
  };
}

function findDirectiveOccurrences(content: string): DirectiveOccurrence[] {
  const occurrences: DirectiveOccurrence[] = [];
  let searchIndex = 0;

  while (searchIndex < content.length) {
    const openIndex = content.indexOf(OPEN_TAG, searchIndex);
    if (openIndex === -1) {
      break;
    }

    const candidate = parseDirectiveCandidate(content, openIndex);
    if (candidate.kind === 'valid') {
      occurrences.push(candidate.occurrence);
    }
    searchIndex = candidate.nextSearchIndex;
  }

  return occurrences;
}

function isNewline(character: string | undefined): boolean {
  return character === '\n' || character === '\r';
}

function mergePromptSegments(left: string, right: string): string {
  const normalizedLeft = left.replace(/[ \t]+$/g, '');
  const normalizedRight = isNewline(right[0])
    ? right
    : right.replace(/^[ \t]+/g, '');

  if (normalizedLeft.length === 0) {
    return normalizedRight.replace(/^(?:\r?\n)+/g, '');
  }

  if (normalizedRight.length === 0) {
    return normalizedLeft.replace(/(?:\r?\n)+$/g, '');
  }

  const leftLast = normalizedLeft[normalizedLeft.length - 1];
  const rightFirst = normalizedRight[0];

  if (isNewline(leftLast) && isNewline(rightFirst)) {
    return `${normalizedLeft.replace(/(?:\r?\n)+$/g, '\n')}${normalizedRight.replace(/^(?:\r?\n)+/g, '')}`;
  }

  if (!/\s/.test(leftLast) && !/\s/.test(rightFirst)) {
    return `${normalizedLeft} ${normalizedRight}`;
  }

  return `${normalizedLeft}${normalizedRight}`;
}

function removeDirectiveOccurrences(content: string, occurrences: DirectiveOccurrence[]): string {
  if (occurrences.length === 0) {
    return content;
  }

  let prompt = content.slice(0, occurrences[0]!.start);
  for (let index = 0; index < occurrences.length; index += 1) {
    const occurrence = occurrences[index]!;
    const nextOccurrence = occurrences[index + 1];
    const nextSegment = content.slice(occurrence.end, nextOccurrence?.start ?? content.length);
    prompt = mergePromptSegments(prompt, nextSegment);
  }

  return prompt;
}

export function preprocessConversationMessage(content: string): PreprocessedConversationMessage {
  const occurrences = findDirectiveOccurrences(content);
  if (occurrences.length === 0) {
    return {
      prompt: content,
      directives: [],
    };
  }

  return {
    prompt: removeDirectiveOccurrences(content, occurrences),
    directives: [occurrences[occurrences.length - 1]!.directive],
  };
}

export function applyMessageControlDirectives(options: {
  conversationId: string;
  directives: MessageControlDirective[];
}): SessionControlResult[] {
  const lastBackendDirective = [...options.directives]
    .reverse()
    .find((directive) => directive.type === 'backend');

  if (!lastBackendDirective) {
    return [];
  }

  const result = applySessionControlCommand({
    conversationId: options.conversationId,
    type: 'backend',
    value: lastBackendDirective.value,
  });

  if (result.kind === 'backend' && result.requiresConfirmation) {
    return [
      result,
      applySessionControlCommand({
        conversationId: options.conversationId,
        type: 'confirm-backend',
        value: result.requestedBackend ?? lastBackendDirective.value,
      }),
    ];
  }

  return [result];
}
