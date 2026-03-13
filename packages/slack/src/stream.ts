import { convertMarkdownToSlackMrkdwn } from './formatting.js';

type SlackStreamTransport = {
  sendMessage(payload: { channelId: string; threadTs?: string; text: string; blocks?: unknown }): Promise<{ ts: string }>;
  updateMessage(payload: { channelId: string; ts: string; text: string; blocks?: unknown }): Promise<void>;
};

type SlackStreamTarget = {
  channelId: string;
  threadTs: string;
};

type SlackStreamEvent =
  | { type: 'environment'; environment: unknown }
  | { type: 'text'; delta: string }
  | { type: 'tool'; summary: string }
  | { type: 'status'; status: string }
  | { type: 'done'; result: string }
  | { type: 'error'; error: string };

export async function streamSlackMessages(
  options: {
    transport: SlackStreamTransport;
    target: SlackStreamTarget;
    updateIntervalMs: number;
  },
  events: AsyncIterable<SlackStreamEvent>,
): Promise<void> {
  let messageTs: string | undefined;
  let buffer = '';
  let lastFlush = 0;
  let lastRenderedText: string | undefined;

  const flush = async (): Promise<void> => {
    const text = convertMarkdownToSlackMrkdwn(buffer.trim() || 'Thinking...');
    if (messageTs && text === lastRenderedText) {
      return;
    }

    if (!messageTs) {
      const created = await options.transport.sendMessage({
        channelId: options.target.channelId,
        threadTs: options.target.threadTs,
        text,
      });
      messageTs = created.ts;
      lastRenderedText = text;
      lastFlush = Date.now();
      return;
    }

    try {
      await options.transport.updateMessage({
        channelId: options.target.channelId,
        ts: messageTs,
        text,
      });
    } catch {
      const created = await options.transport.sendMessage({
        channelId: options.target.channelId,
        threadTs: options.target.threadTs,
        text,
      });
      messageTs = created.ts;
    }

    lastRenderedText = text;
    lastFlush = Date.now();
  };

  for await (const event of events) {
    if (event.type === 'environment') {
      continue;
    }

    if (event.type === 'text') {
      buffer += event.delta;
    } else if (event.type === 'tool') {
      buffer += `${buffer ? '\n' : ''}> ${event.summary}\n`;
    } else if (event.type === 'status' && !buffer.trim()) {
      buffer = `Thinking: ${event.status}`;
    } else if (event.type === 'error') {
      buffer += `${buffer ? '\n\n' : ''}Error: ${event.error}`;
    } else if (event.type === 'done' && (!buffer.trim() || event.result.trim())) {
      buffer = event.result;
    }

    if (Date.now() - lastFlush >= options.updateIntervalMs) {
      await flush();
    }
  }

  await flush();
}
