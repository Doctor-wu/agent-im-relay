export type AgentMode = 'code' | 'ask';
export type PermissionMode = 'auto' | 'safe';

const codeModeArgs = ['--dangerously-skip-permissions'];
const askModeArgs = ['--allowedTools', ''];

export function toolsForMode(
  mode: AgentMode,
  permissionMode: PermissionMode = 'auto',
): string[] {
  if (mode !== 'code') {
    return [...askModeArgs];
  }

  return permissionMode === 'safe' ? [] : [...codeModeArgs];
}
