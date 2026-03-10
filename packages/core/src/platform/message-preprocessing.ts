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

const BACKEND_TAG_PATTERN = /<set-backend>\s*(claude|codex)\s*<\/set-backend>/gi;

function normalizePromptAfterDirectiveRemoval(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function preprocessConversationMessage(content: string): PreprocessedConversationMessage {
  const directives: MessageControlDirective[] = [];
  const prompt = normalizePromptAfterDirectiveRemoval(
    content.replace(BACKEND_TAG_PATTERN, (_match, backend: string) => {
      directives.push({
        type: 'backend',
        value: backend.toLowerCase() as BackendName,
      });
      return ' ';
    }),
  );

  return {
    prompt,
    directives,
  };
}

export function applyMessageControlDirectives(options: {
  conversationId: string;
  directives: MessageControlDirective[];
}): SessionControlResult[] {
  const results: SessionControlResult[] = [];

  for (const directive of options.directives) {
    const result = applySessionControlCommand({
      conversationId: options.conversationId,
      type: 'backend',
      value: directive.value,
    });
    results.push(result);

    // Control tags are explicit instructions, so text-driven backend switches
    // should complete immediately instead of waiting for a platform UI confirm step.
    if (result.kind === 'backend' && result.requiresConfirmation) {
      results.push(applySessionControlCommand({
        conversationId: options.conversationId,
        type: 'confirm-backend',
        value: result.requestedBackend ?? directive.value,
      }));
    }
  }

  return results;
}
