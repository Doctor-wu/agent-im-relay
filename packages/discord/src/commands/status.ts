import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import {
  activeConversations,
  conversationBackend,
  conversationCwd,
  conversationEffort,
  conversationModels,
  threadContinuationSnapshots,
  threadSessionBindings,
} from '@agent-im-relay/core';

export const statusCommand = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show the current agent configuration and session status for this thread')
  .setDMPermission(false);

function formatSessionStatus(conversationId: string): string {
  if (activeConversations.has(conversationId)) {
    return '🟢 Running';
  }

  const binding = threadSessionBindings.get(conversationId);
  if (!binding) {
    return '⚪ No session';
  }

  if (binding.nativeSessionStatus === 'confirmed') {
    return '🔵 Idle (session ready to resume)';
  }

  if (binding.nativeSessionStatus === 'invalid') {
    return '🔴 Session invalidated';
  }

  return '🟡 Pending';
}

function formatLastTask(conversationId: string): string | null {
  const snapshot = threadContinuationSnapshots.get(conversationId);
  if (!snapshot) {
    return null;
  }

  const summary = snapshot.taskSummary.length > 120
    ? snapshot.taskSummary.slice(0, 117) + '...'
    : snapshot.taskSummary;

  const stopReasonEmoji: Record<string, string> = {
    completed: '✅',
    timeout: '⏱️',
    interrupted: '⏹️',
    error: '❌',
  };

  const emoji = stopReasonEmoji[snapshot.whyStopped] ?? '•';
  return `${emoji} ${summary}`;
}

export async function handleStatusCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel;
  if (!channel?.isThread()) {
    await interaction.reply({ content: 'This command only works inside a thread.', ephemeral: true });
    return;
  }

  const id = channel.id;
  const backend = conversationBackend.get(id) ?? 'claude (default)';
  const model = conversationModels.get(id) ?? 'backend default';
  const effort = conversationEffort.get(id) ?? 'backend default';
  const cwd = conversationCwd.get(id) ?? 'auto-detected';

  const lines = [
    '## Thread Status',
    `- **Backend:** ${backend}`,
    `- **Model:** ${model}`,
    `- **Effort:** ${effort}`,
    `- **Working directory:** \`${cwd}\``,
    `- **Session:** ${formatSessionStatus(id)}`,
  ];

  const lastTask = formatLastTask(id);
  if (lastTask) {
    lines.push(`- **Last task:** ${lastTask}`);
  }

  await interaction.reply({ content: lines.join('\n'), ephemeral: true });
}
