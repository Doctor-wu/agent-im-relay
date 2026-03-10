import { stripArtifactManifest, type AgentEnvironment, type AgentStreamEvent } from '@agent-im-relay/core';

export type TelegramTarget = {
  chatId: number;
  threadId?: number;
};

export type TelegramTransport = {
  sendMessage(
    target: TelegramTarget,
    text: string,
    options?: { parseMode?: 'HTML' },
  ): Promise<number>;
  editMessage(
    chatId: number,
    messageId: number,
    text: string,
    options?: { parseMode?: 'HTML' },
  ): Promise<void>;
  sendDocument(target: TelegramTarget, filePath: string, caption?: string): Promise<void>;
};

// --- HTML conversion ---

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function processTextSegment(text: string): string {
  let result = escapeHtml(text);
  result = result.replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>');
  result = result.replace(/^#{1,6} (.+)$/gm, '<b>$1</b>');
  result = result.replace(/^---+\s*$/gm, '');
  return result;
}

export function convertMarkdownForTelegram(text: string): string {
  const fenceRegex = /```(\w*)\n?([\s\S]*?)```/g;
  const result: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  fenceRegex.lastIndex = 0;
  while ((match = fenceRegex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) {
      const inlineParts = before.split(/(`[^`\n]+`)/g);
      for (let i = 0; i < inlineParts.length; i++) {
        const part = inlineParts[i] ?? '';
        if (i % 2 === 1) {
          result.push(`<code>${escapeHtml(part.slice(1, -1))}</code>`);
        } else {
          result.push(processTextSegment(part));
        }
      }
    }

    const codeContent = (match[2] ?? '').trimEnd();
    result.push(`<pre><code>${escapeHtml(codeContent)}</code></pre>`);
    lastIndex = match.index + match[0].length;
  }

  const remaining = text.slice(lastIndex);
  if (remaining) {
    const inlineParts = remaining.split(/(`[^`\n]+`)/g);
    for (let i = 0; i < inlineParts.length; i++) {
      const part = inlineParts[i] ?? '';
      if (i % 2 === 1) {
        result.push(`<code>${escapeHtml(part.slice(1, -1))}</code>`);
      } else {
        result.push(processTextSegment(part));
      }
    }
  }

  return result.join('').replace(/\n{3,}/g, '\n\n').trim();
}

// --- Chunking ---

export function chunkForTelegram(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf('\n\n', maxLength);
    if (splitIndex < Math.floor(maxLength * 0.4)) {
      splitIndex = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitIndex < Math.floor(maxLength * 0.4)) {
      splitIndex = maxLength;
    }

    const chunk = remaining.slice(0, splitIndex);
    const openPre = (chunk.match(/<pre>/g) ?? []).length;
    const closePre = (chunk.match(/<\/pre>/g) ?? []).length;
    if (openPre > closePre) {
      chunks.push(chunk + '</pre>');
      remaining = '<pre>' + remaining.slice(splitIndex).trimStart();
    } else {
      chunks.push(chunk);
      remaining = remaining.slice(splitIndex).trimStart();
    }
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

// --- Tool formatting ---

const TOOL_ICONS: Record<string, string> = {
  Read: '📖',
  Write: '✏️',
  Edit: '✏️',
  MultiEdit: '✏️',
  Bash: '💻',
  Glob: '🔍',
  Grep: '🔍',
  LS: '📂',
  WebSearch: '🌐',
  WebFetch: '🌐',
  TodoRead: '📋',
  TodoWrite: '📋',
};

function formatToolLine(summary: string): string {
  const match = summary.match(/^running (\w+)\s*(.*)/s);
  if (!match) {
    const truncated = summary.length > 200 ? summary.slice(0, 197) + '...' : summary;
    return `🔧 ${escapeHtml(truncated)}`;
  }

  const name = match[1]!;
  const icon = TOOL_ICONS[name] ?? '🔧';
  const rawInput = match[2]?.trim();

  if (!rawInput) {
    return `${icon} <b>${escapeHtml(name)}</b>`;
  }

  try {
    const parsed = JSON.parse(rawInput) as Record<string, unknown>;
    let detail = '';
    if (name === 'Bash' && typeof parsed.command === 'string') {
      const cmd = parsed.command.length > 120 ? parsed.command.slice(0, 117) + '...' : parsed.command;
      detail = `<code>${escapeHtml(cmd)}</code>`;
    } else if (['Read', 'Write', 'Edit', 'MultiEdit'].includes(name) && typeof parsed.file_path === 'string') {
      detail = `<code>${escapeHtml(parsed.file_path)}</code>`;
    } else if (name === 'Grep' && typeof parsed.pattern === 'string') {
      const path = typeof parsed.path === 'string' ? ` in <code>${escapeHtml(parsed.path)}</code>` : '';
      detail = `<code>${escapeHtml(parsed.pattern)}</code>${path}`;
    } else if (name === 'Glob' && typeof parsed.pattern === 'string') {
      detail = `<code>${escapeHtml(parsed.pattern)}</code>`;
    }
    return detail
      ? `${icon} <b>${escapeHtml(name)}</b> ${detail}`
      : `${icon} <b>${escapeHtml(name)}</b>`;
  } catch {
    const truncated = rawInput.length > 150 ? rawInput.slice(0, 147) + '...' : rawInput;
    return `${icon} <b>${escapeHtml(name)}</b> ${escapeHtml(truncated)}`;
  }
}

function capitalize(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

export function formatEnvironmentSummary(environment: AgentEnvironment): string {
  const model = environment.model.resolved ?? environment.model.requested ?? 'backend default';
  const cwd = environment.cwd.value ?? 'unknown';
  const cwdSuffix = environment.cwd.source === 'auto-detected'
    ? ' (auto-detected)'
    : environment.cwd.source === 'explicit'
      ? ' (manual override)'
      : '';
  const gitBranch = environment.git.isRepo
    ? environment.git.branch ?? 'unknown'
    : 'not a git repository';

  return [
    '<b>Environment</b>',
    `- Backend: ${capitalize(environment.backend)}`,
    `- Model: ${model}`,
    `- Working directory: ${cwd}${cwdSuffix}`,
    `- Git branch: ${gitBranch}`,
    `- Mode: ${environment.mode}`,
  ].join('\n');
}

// --- Main streaming function ---

type StreamOptions = {
  showEnvironment?: boolean;
  streamUpdateIntervalMs: number;
  messageCharLimit: number;
};

export async function streamAgentToTelegram(
  transport: TelegramTransport,
  target: TelegramTarget,
  events: AsyncIterable<AgentStreamEvent>,
  options: StreamOptions,
): Promise<void> {
  const maxLength = Math.max(200, options.messageCharLimit);
  let buffer = '';
  let lastFlush = 0;
  let toolCount = 0;
  let isThinking = false;
  let sentMessageIds: number[] = [];
  let renderedChunks: string[] = [];

  const flush = async (): Promise<void> => {
    const strippedBody = stripArtifactManifest(buffer).trim();
    const body = strippedBody || '⏳ Thinking...';
    const converted = convertMarkdownForTelegram(body);
    const chunks = chunkForTelegram(converted || '⏳', maxLength);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i] ?? '';
      const previous = renderedChunks[i];
      const existingId = sentMessageIds[i];

      if (chunk === previous) continue;

      if (!existingId) {
        const msgId = await transport.sendMessage(target, chunk || '…', { parseMode: 'HTML' });
        sentMessageIds.push(msgId);
      } else {
        await transport.editMessage(target.chatId, existingId, chunk || '…', { parseMode: 'HTML' }).catch(() => {});
      }
    }

    renderedChunks = chunks;
    lastFlush = Date.now();
  };

  for await (const event of events) {
    if (event.type === 'environment') {
      if (options.showEnvironment) {
        await transport.sendMessage(target, formatEnvironmentSummary(event.environment), { parseMode: 'HTML' });
      }
    } else if (event.type === 'text') {
      if (isThinking) {
        isThinking = false;
        buffer = '';
      }
      buffer += event.delta;
    } else if (event.type === 'tool') {
      toolCount++;
      buffer += '\n' + formatToolLine(event.summary) + '\n';
    } else if (event.type === 'status') {
      if (!isThinking && !buffer.trim()) {
        isThinking = true;
        buffer = `⏳ <i>${escapeHtml(event.status)}</i>`;
      }
    } else if (event.type === 'error') {
      if (event.error === 'Agent request aborted') {
        buffer += '\n\n⏹️ 当前任务已中断。\n';
      } else {
        buffer += `\n\n❌ <b>Error:</b> ${escapeHtml(event.error)}\n`;
      }
    } else if (event.type === 'done') {
      if (!buffer.trim() && event.result) {
        buffer = event.result;
      }
      if (toolCount > 0) {
        buffer += `\n\n<i>🔧 ${toolCount} tool${toolCount > 1 ? 's' : ''} used</i>`;
      }
    }

    if (Date.now() - lastFlush >= options.streamUpdateIntervalMs) {
      await flush();
    }
  }

  await flush();
}
