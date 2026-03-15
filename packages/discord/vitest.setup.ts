import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const homeDir = mkdtempSync(join(tmpdir(), 'agent-inbox-discord-vitest-'));
const relayDir = join(homeDir, '.agent-inbox');

mkdirSync(relayDir, { recursive: true });
writeFileSync(join(relayDir, 'config.jsonl'), [
  '{"type":"meta","version":1}',
  '{"type":"runtime","config":{"streamUpdateIntervalMs":1000,"discordMessageCharLimit":1900}}',
  '{"type":"im","id":"discord","enabled":true,"config":{"token":"test-token","clientId":"test-client-id"}}',
].join('\n'), 'utf-8');

process.env.HOME = homeDir;
delete process.env.DISCORD_TOKEN;
delete process.env.DISCORD_CLIENT_ID;
