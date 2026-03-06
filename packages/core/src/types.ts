// === Base identifiers ===

/** Platform-agnostic conversation identifier */
export type ConversationId = string;
/** Platform-agnostic message identifier */
export type MessageId = string;

// === Agent status ===

export type AgentStatus = 'thinking' | 'tool_running' | 'done' | 'error';

// === Incoming message model ===

export interface IncomingMessage {
  id: MessageId;
  conversationId: ConversationId | null;
  content: string;
  authorId: string;
  authorName: string;
  isBotMention: boolean;
  /** Platform-specific raw message object */
  raw: unknown;
}

// === Formatted content ===

export interface FormattedContent {
  text: string;
  /** Platform-specific rich content (Discord embeds, Slack blocks, etc.) */
  extras?: unknown;
}

// === Command definitions ===

export interface CommandArgChoice {
  name: string;
  value: string;
}

export interface CommandArg {
  name: string;
  description: string;
  type: 'string' | 'choice';
  required?: boolean;
  choices?: CommandArgChoice[];
}

export interface CommandDefinition {
  name: string;
  description: string;
  args: CommandArg[];
  /** If true, command only works within a conversation context */
  requiresConversation?: boolean;
}

export interface CommandInvocation {
  name: string;
  args: Record<string, string>;
  conversationId: ConversationId | null;
  authorId: string;
  /** Platform-specific reply function for ephemeral feedback */
  reply: (content: string) => Promise<void>;
}

// === Select menu / prompt input ===

export interface SelectMenuOption {
  label: string;
  value: string;
  description?: string;
}

export interface SelectMenuOptions {
  placeholder: string;
  options: SelectMenuOption[];
}

export interface PromptInputOptions {
  title: string;
  label: string;
  placeholder?: string;
}

// === Capability interfaces ===

/** 1. Send and edit messages — REQUIRED */
export interface MessageSender {
  send(conversationId: ConversationId, content: string, extras?: unknown): Promise<MessageId>;
  edit(conversationId: ConversationId, messageId: MessageId, content: string, extras?: unknown): Promise<void>;
  maxMessageLength: number;
}

/** 2. Manage conversation threads/contexts — optional */
export interface ConversationManager {
  createConversation(triggerMessageId: MessageId, context: { authorName: string; prompt: string }): Promise<ConversationId>;
  getConversationId(message: IncomingMessage): ConversationId | null;
}

/** 3. Show agent status to users — optional */
export interface StatusIndicator {
  setStatus(conversationId: ConversationId, status: AgentStatus, triggerMessageRaw?: unknown): Promise<void>;
  clearStatus(conversationId: ConversationId, triggerMessageRaw?: unknown): Promise<void>;
}

/** 4. Register and dispatch platform commands — optional */
export interface CommandRegistry {
  registerCommands(commands: CommandDefinition[]): Promise<void>;
}

/** 5. Rich interactive UI (select menus, modals) — optional */
export interface InteractiveUI {
  showSelectMenu(conversationId: ConversationId, options: SelectMenuOptions): Promise<string>;
  showPromptInput(conversationId: ConversationId, options: PromptInputOptions): Promise<string>;
}

/** 6. Platform-specific Markdown conversion — optional */
export interface MarkdownFormatter {
  format(markdown: string): FormattedContent;
}

// === Adapter composite ===

export interface PlatformAdapter {
  readonly name: string;
  readonly messageSender: MessageSender;
  readonly conversationManager?: ConversationManager;
  readonly statusIndicator?: StatusIndicator;
  readonly commandRegistry?: CommandRegistry;
  readonly interactiveUI?: InteractiveUI;
  readonly markdownFormatter?: MarkdownFormatter;
}
