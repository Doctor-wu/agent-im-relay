import {
  downloadIncomingAttachments,
  stageOutgoingArtifacts,
  type DownloadedAttachment,
  type RemoteAttachmentLike,
} from '@agent-im-relay/core';

export type FeishuFileLike = RemoteAttachmentLike & {
  fileKey?: string;
};

export async function ingestFeishuFiles(options: {
  conversationId: string;
  files: FeishuFileLike[];
  sourceMessageId?: string;
  fetchImpl?: typeof fetch;
}): Promise<DownloadedAttachment[]> {
  return downloadIncomingAttachments({
    conversationId: options.conversationId,
    attachments: options.files,
    sourceMessageId: options.sourceMessageId,
    fetchImpl: options.fetchImpl,
  });
}

export async function uploadFeishuArtifacts(options: {
  conversationId: string;
  cwd: string;
  resultText: string;
  sourceMessageId?: string;
  uploader: (payload: { filePath: string }) => Promise<void>;
}): Promise<{ uploaded: string[]; warnings: string[] }> {
  const staged = await stageOutgoingArtifacts({
    conversationId: options.conversationId,
    cwd: options.cwd,
    resultText: options.resultText,
    sourceMessageId: options.sourceMessageId,
  });

  const warnings = [...staged.warnings];
  const uploaded: string[] = [];

  for (const filePath of staged.files) {
    try {
      await options.uploader({ filePath });
      uploaded.push(filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`⚠️ Failed to upload returned file \`${filePath}\`: ${message}`);
    }
  }

  return { uploaded, warnings };
}
