import { dirname, join } from 'node:path';
import {
  applyCoreConfigEnvironment,
  readSlackRelayConfig,
  type SlackRelayConfig,
} from '@agent-im-relay/core';

function setOptionalBooleanEnv(key: string, value: boolean): void {
  process.env[key] = value ? 'true' : 'false';
}

export interface SlackConfig extends SlackRelayConfig {}

export function resolveSlackConversationStateFile(stateFile: string): string {
  return join(dirname(stateFile), 'slack-conversations.json');
}

export function resolveSlackPendingRunStateFile(stateFile: string): string {
  return join(dirname(stateFile), 'slack-pending-runs.json');
}

export function readSlackConfig(baseDir?: string): SlackConfig {
  return readSlackRelayConfig(baseDir);
}

export function applySlackConfigEnvironment(config: SlackConfig): void {
  applyCoreConfigEnvironment(config);
  process.env['SLACK_BOT_TOKEN'] = config.slackBotToken;
  process.env['SLACK_APP_TOKEN'] = config.slackAppToken;
  process.env['SLACK_SIGNING_SECRET'] = config.slackSigningSecret;
  setOptionalBooleanEnv('SLACK_SOCKET_MODE', config.slackSocketMode);
}
