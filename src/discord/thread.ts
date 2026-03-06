import {
  ChannelType,
  ThreadAutoArchiveDuration,
  type AnyThreadChannel,
  type ChatInputCommandInteraction,
  type Message,
  type NewsChannel,
  type TextChannel,
} from 'discord.js';

type ThreadCapableChannel = TextChannel | NewsChannel;

export function sanitizeThreadName(prompt: string): string {
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

export async function ensureMentionThread(message: Message<true>, prompt: string): Promise<AnyThreadChannel> {
  // If the message is already in a thread, just use it
  if (message.channel.isThread()) {
    return message.channel;
  }

  const channel = message.channel;
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    throw new Error('This channel type does not support thread creation for mentions.');
  }

  // Always create a new seed message for the thread to avoid
  // "A thread has already been created for this message" errors.
  // This also means each @ mention gets its own thread = its own session.
  const seedMessage = await channel.send('🧵 Starting Claude session...');

  return seedMessage.startThread({
    autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    name: sanitizeThreadName(prompt),
    reason: `Claude mention started by ${message.author.tag}`,
  });
}
