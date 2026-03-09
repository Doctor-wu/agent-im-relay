import { stageOutgoingArtifacts } from '@agent-im-relay/core';
import { buildDiscordReplyPayload, type DiscordReplyContext } from './reply-context.js';

type ArtifactUploadChannel = {
  send(payload: string | {
    content: string;
    files?: string[];
    allowedMentions?: { users: string[] };
  }): Promise<unknown>;
};

type PublishConversationArtifactsOptions = {
  conversationId: string;
  cwd?: string;
  resultText?: string;
  stagedFiles?: string[];
  warnings?: string[];
  channel: ArtifactUploadChannel;
  sourceMessageId?: string;
  replyContext?: DiscordReplyContext;
};

export async function publishConversationArtifacts({
  conversationId,
  cwd,
  resultText,
  stagedFiles,
  warnings: providedWarnings,
  channel,
  sourceMessageId,
  replyContext,
}: PublishConversationArtifactsOptions): Promise<void> {
  const staged = (stagedFiles && providedWarnings)
    ? { files: stagedFiles, warnings: providedWarnings }
    : await stageOutgoingArtifacts({
      conversationId,
      cwd: cwd ?? '',
      resultText: resultText ?? '',
      sourceMessageId,
    });

  const warnings = [...staged.warnings];

  if (staged.files.length > 0) {
    try {
      await channel.send(buildDiscordReplyPayload(
        `📎 Returned ${staged.files.length} file${staged.files.length > 1 ? 's' : ''}.`,
        replyContext,
        { files: staged.files },
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`⚠️ Failed to upload returned files: ${message}`);
    }
  }

  if (warnings.length > 0) {
    await channel.send(buildDiscordReplyPayload(warnings.join('\n'), replyContext));
  }
}
