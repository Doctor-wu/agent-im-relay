import {
  ChannelType,
  ThreadAutoArchiveDuration,
  type AnyThreadChannel,
  type ChatInputCommandInteraction,
  type NewsChannel,
  type TextChannel,
} from 'discord.js';

type ThreadCapableChannel = TextChannel | NewsChannel;

function sanitizeThreadName(prompt: string): string {
  const trimmed = prompt.replace(/\s+/g, ' ').trim();
  const prefix = trimmed.length > 0 ? trimmed.slice(0, 72) : 'New coding task';
  return `code: ${prefix}`.slice(0, 100);
}

function isThreadCapableChannel(channel: ChatInputCommandInteraction['channel']): channel is ThreadCapableChannel {
  if (!channel) return false;
  return channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
}

export async function ensureCodeThread(
  interaction: ChatInputCommandInteraction,
  prompt: string,
): Promise<AnyThreadChannel> {
  const channel = interaction.channel;

  if (!channel) {
    throw new Error('No channel context available for thread creation.');
  }

  if (channel.isThread()) {
    return channel;
  }

  if (!isThreadCapableChannel(channel)) {
    throw new Error('This channel type does not support thread creation for /code.');
  }

  const seedMessage = await channel.send(`🧵 Starting /code task for <@${interaction.user.id}>`);
  const thread = await seedMessage.startThread({
    autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    name: sanitizeThreadName(prompt),
    reason: `Claude code task started by ${interaction.user.tag}`,
  });

  return thread;
}
