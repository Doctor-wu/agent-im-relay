import type { Options } from '@anthropic-ai/claude-agent-sdk';

export type AgentMode = 'code' | 'ask';

const codeTools: NonNullable<Options['tools']> = {
  type: 'preset',
  preset: 'claude_code',
};

const askTools: NonNullable<Options['tools']> = [];

export function toolsForMode(mode: AgentMode): NonNullable<Options['tools']> {
  return mode === 'code' ? codeTools : askTools;
}
