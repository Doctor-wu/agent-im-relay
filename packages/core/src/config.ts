import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import type { RelayPaths } from './paths.js';
import { resolveRelayPaths } from './paths.js';

export type RuntimeConfig = {
  agentTimeoutMs?: number;
  artifactRetentionDays?: number;
  artifactMaxSizeBytes?: number;
  streamUpdateIntervalMs?: number;
  discordMessageCharLimit?: number;
  claudeCwd?: string;
  claudeBin?: string;
  codexBin?: string;
  opencodeBin?: string;
};

export type DiscordImConfig = {
  token?: string;
  clientId?: string;
  guildIds?: string[];
  allowedChannelIds?: string[];
};

export type FeishuImConfig = {
  appId?: string;
  appSecret?: string;
  verificationToken?: string;
  encryptKey?: string;
  baseUrl?: string;
  port?: number;
  modelSelectionTimeoutMs?: number;
};

export type SlackImConfig = {
  botToken?: string;
  appToken?: string;
  signingSecret?: string;
  socketMode?: boolean;
};

export type MetaRecord = {
  type: 'meta';
  version: number;
};

export type RuntimeRecord = {
  type: 'runtime';
  note?: string;
  config: RuntimeConfig;
};

export type LocalPreferencesRecord = {
  type: 'local-preferences';
  lastUsedPlatform?: 'discord' | 'feishu' | 'slack';
};

export type DiscordImRecord = {
  type: 'im';
  id: 'discord';
  enabled: boolean;
  note?: string;
  config: DiscordImConfig;
};

export type FeishuImRecord = {
  type: 'im';
  id: 'feishu';
  enabled: boolean;
  note?: string;
  config: FeishuImConfig;
};

export type SlackImRecord = {
  type: 'im';
  id: 'slack';
  enabled: boolean;
  note?: string;
  config: SlackImConfig;
};

export type RelayConfigRecord =
  | MetaRecord
  | RuntimeRecord
  | LocalPreferencesRecord
  | DiscordImRecord
  | FeishuImRecord
  | SlackImRecord;

export type AvailableIm =
  | {
    id: 'discord';
    note?: string;
    config: Required<Pick<DiscordImConfig, 'token' | 'clientId'>> & Pick<DiscordImConfig, 'guildIds' | 'allowedChannelIds'>;
  }
  | {
    id: 'feishu';
    note?: string;
    config: Required<Pick<FeishuImConfig, 'appId' | 'appSecret'>> & Pick<FeishuImConfig, 'verificationToken' | 'encryptKey' | 'baseUrl' | 'port' | 'modelSelectionTimeoutMs'>;
  }
  | {
    id: 'slack';
    note?: string;
    config: Required<Pick<SlackImConfig, 'botToken' | 'appToken' | 'signingSecret'>> & Pick<SlackImConfig, 'socketMode'>;
  };

export interface LoadedRelayConfig {
  records: RelayConfigRecord[];
  availableIms: AvailableIm[];
  runtime: RuntimeConfig;
  lastUsedPlatform?: AvailableIm['id'];
  errors: string[];
}

export interface CoreConfig {
  agentTimeoutMs: number;
  claudeCwd: string;
  stateFile: string;
  artifactsBaseDir: string;
  artifactRetentionDays: number;
  artifactMaxSizeBytes: number;
  claudeBin: string;
  codexBin: string;
  opencodeBin: string;
}

export interface DiscordRelayConfig extends CoreConfig {
  discordToken: string;
  discordClientId: string;
  guildIds: string[];
  allowedChannelIds: string[];
  streamUpdateIntervalMs: number;
  discordMessageCharLimit: number;
  maxAttachmentSizeBytes: number;
}

export interface FeishuRelayConfig extends CoreConfig {
  feishuAppId: string;
  feishuAppSecret: string;
  feishuEncryptKey?: string;
  feishuVerificationToken?: string;
  feishuBaseUrl: string;
  feishuPort?: number;
  feishuModelSelectionTimeoutMs: number;
}

export interface SlackRelayConfig extends CoreConfig {
  slackBotToken: string;
  slackAppToken: string;
  slackSigningSecret: string;
  slackSocketMode: boolean;
}

const DEFAULT_META_RECORD: MetaRecord = {
  type: 'meta',
  version: 1,
};

const DEFAULT_RUNTIME_RECORD: RuntimeRecord = {
  type: 'runtime',
  note: 'Global runtime knobs used by the distributed relay.',
  config: {
    agentTimeoutMs: 10 * 60 * 1000,
    artifactRetentionDays: 14,
    artifactMaxSizeBytes: 8 * 1024 * 1024,
    streamUpdateIntervalMs: 1000,
    discordMessageCharLimit: 1900,
    claudeBin: 'claude',
    codexBin: 'codex',
    opencodeBin: 'opencode',
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value
    .map(item => asString(item))
    .filter((item): item is string => Boolean(item));

  return values.length > 0 ? values : undefined;
}

function asPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
}

function asPlatformId(value: unknown): AvailableIm['id'] | undefined {
  return value === 'discord' || value === 'feishu' || value === 'slack'
    ? value
    : undefined;
}

function normalizeRuntimeRecord(value: Record<string, unknown>): RuntimeRecord {
  const config = isRecord(value.config) ? value.config : {};

  return {
    type: 'runtime',
    note: asString(value.note),
    config: {
      agentTimeoutMs: asPositiveNumber(config.agentTimeoutMs),
      artifactRetentionDays: asPositiveNumber(config.artifactRetentionDays),
      artifactMaxSizeBytes: asPositiveNumber(config.artifactMaxSizeBytes),
      streamUpdateIntervalMs: asPositiveNumber(config.streamUpdateIntervalMs),
      discordMessageCharLimit: asPositiveNumber(config.discordMessageCharLimit),
      claudeCwd: asString(config.claudeCwd),
      claudeBin: asString(config.claudeBin),
      codexBin: asString(config.codexBin),
      opencodeBin: asString(config.opencodeBin),
    },
  };
}

function normalizeLocalPreferencesRecord(
  value: Record<string, unknown>,
): LocalPreferencesRecord {
  return {
    type: 'local-preferences',
    lastUsedPlatform: asPlatformId(value.lastUsedPlatform),
  };
}

function normalizeDiscordImRecord(value: Record<string, unknown>): DiscordImRecord {
  const config = isRecord(value.config) ? value.config : {};

  return {
    type: 'im',
    id: 'discord',
    enabled: asBoolean(value.enabled, true),
    note: asString(value.note),
    config: {
      token: asString(config.token),
      clientId: asString(config.clientId),
      guildIds: asStringList(config.guildIds),
      allowedChannelIds: asStringList(config.allowedChannelIds),
    },
  };
}

function normalizeFeishuImRecord(value: Record<string, unknown>): FeishuImRecord {
  const config = isRecord(value.config) ? value.config : {};

  return {
    type: 'im',
    id: 'feishu',
    enabled: asBoolean(value.enabled, true),
    note: asString(value.note),
    config: {
      appId: asString(config.appId),
      appSecret: asString(config.appSecret),
      verificationToken: asString(config.verificationToken),
      encryptKey: asString(config.encryptKey),
      baseUrl: asString(config.baseUrl),
      port: asPositiveNumber(config.port),
      modelSelectionTimeoutMs: asPositiveNumber(config.modelSelectionTimeoutMs),
    },
  };
}

function normalizeSlackImRecord(value: Record<string, unknown>): SlackImRecord {
  const config = isRecord(value.config) ? value.config : {};

  return {
    type: 'im',
    id: 'slack',
    enabled: asBoolean(value.enabled, true),
    note: asString(value.note),
    config: {
      botToken: asString(config.botToken),
      appToken: asString(config.appToken),
      signingSecret: asString(config.signingSecret),
      socketMode: typeof config.socketMode === 'boolean' ? config.socketMode : undefined,
    },
  };
}

function parseConfigRecord(value: unknown, lineNumber: number): {
  record?: RelayConfigRecord;
  error?: string;
} {
  if (!isRecord(value)) {
    return { error: `Line ${lineNumber}: expected a JSON object.` };
  }

  if (value.type === 'meta') {
    if (typeof value.version !== 'number' || value.version <= 0) {
      return { error: `Line ${lineNumber}: meta.version must be a positive number.` };
    }

    return {
      record: {
        type: 'meta',
        version: value.version,
      },
    };
  }

  if (value.type === 'runtime') {
    return { record: normalizeRuntimeRecord(value) };
  }

  if (value.type === 'local-preferences') {
    return { record: normalizeLocalPreferencesRecord(value) };
  }

  if (value.type === 'im') {
    if (value.id === 'discord') {
      return { record: normalizeDiscordImRecord(value) };
    }

    if (value.id === 'feishu') {
      return { record: normalizeFeishuImRecord(value) };
    }

    if (value.id === 'slack') {
      return { record: normalizeSlackImRecord(value) };
    }

    return { error: `Line ${lineNumber}: unsupported im id "${String(value.id)}".` };
  }

  return { error: `Line ${lineNumber}: unsupported record type "${String(value.type)}".` };
}

export function parseConfigJsonl(input: string): LoadedRelayConfig {
  const records: RelayConfigRecord[] = [];
  const errors: string[] = [];

  const lines = input.split('\n');
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      errors.push(`Line ${index + 1}: invalid JSON (${error instanceof Error ? error.message : String(error)}).`);
      continue;
    }

    const result = parseConfigRecord(parsed, index + 1);
    if (result.error) {
      errors.push(result.error);
      continue;
    }

    records.push(result.record!);
  }

  const normalizedRecords = ensureDefaultRecords(records);

  return {
    records: normalizedRecords,
    availableIms: resolveAvailableIms(normalizedRecords),
    runtime: resolveRuntimeConfig(normalizedRecords),
    lastUsedPlatform: resolveLastUsedPlatform(normalizedRecords),
    errors,
  };
}

function emptyLoadedRelayConfig(): LoadedRelayConfig {
  const records = ensureDefaultRecords([]);

  return {
    records,
    availableIms: [],
    runtime: resolveRuntimeConfig(records),
    lastUsedPlatform: undefined,
    errors: [],
  };
}

export function ensureDefaultRecords(records: RelayConfigRecord[]): RelayConfigRecord[] {
  const nextRecords = [...records];

  if (!nextRecords.some(record => record.type === 'meta')) {
    nextRecords.unshift(DEFAULT_META_RECORD);
  }

  if (!nextRecords.some(record => record.type === 'runtime')) {
    nextRecords.push({
      ...DEFAULT_RUNTIME_RECORD,
      config: { ...DEFAULT_RUNTIME_RECORD.config },
    });
  }

  return nextRecords;
}

export function resolveRuntimeConfig(records: RelayConfigRecord[]): RuntimeConfig {
  const runtimeRecord = records.find((record): record is RuntimeRecord => record.type === 'runtime');

  return {
    ...DEFAULT_RUNTIME_RECORD.config,
    ...(runtimeRecord?.config ?? {}),
  };
}

export function resolveLastUsedPlatform(
  records: RelayConfigRecord[],
): AvailableIm['id'] | undefined {
  return records.find(
    (record): record is LocalPreferencesRecord => record.type === 'local-preferences',
  )?.lastUsedPlatform;
}

export function resolveAvailableIms(records: RelayConfigRecord[]): AvailableIm[] {
  const ims = records.filter(
    (record): record is DiscordImRecord | FeishuImRecord | SlackImRecord => record.type === 'im',
  );

  return ims.flatMap((record): AvailableIm[] => {
    if (!record.enabled) {
      return [];
    }

    if (record.id === 'discord') {
      if (!record.config.token || !record.config.clientId) {
        return [];
      }

      return [{
        id: 'discord',
        note: record.note,
        config: {
          token: record.config.token,
          clientId: record.config.clientId,
          guildIds: record.config.guildIds,
          allowedChannelIds: record.config.allowedChannelIds,
        },
      }];
    }

    if (record.id === 'feishu') {
      if (!record.config.appId || !record.config.appSecret) {
        return [];
      }

      return [{
        id: 'feishu',
        note: record.note,
        config: {
          appId: record.config.appId,
          appSecret: record.config.appSecret,
          verificationToken: record.config.verificationToken,
          encryptKey: record.config.encryptKey,
          baseUrl: record.config.baseUrl,
          port: record.config.port,
          modelSelectionTimeoutMs: record.config.modelSelectionTimeoutMs,
        },
      }];
    }

    if (!record.config.botToken || !record.config.appToken || !record.config.signingSecret) {
      return [];
    }

    return [{
      id: 'slack',
      note: record.note,
      config: {
        botToken: record.config.botToken,
        appToken: record.config.appToken,
        signingSecret: record.config.signingSecret,
        socketMode: record.config.socketMode,
      },
    }];
  });
}

export function serializeConfigRecords(records: RelayConfigRecord[]): string {
  return `${ensureDefaultRecords(records).map(record => JSON.stringify(record)).join('\n')}\n`;
}

export async function loadRelayConfig(paths: RelayPaths): Promise<LoadedRelayConfig> {
  try {
    const raw = await readFile(paths.configFile, 'utf-8');
    return parseConfigJsonl(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyLoadedRelayConfig();
    }

    throw error;
  }
}

export function readRelayConfig(baseDir?: string): LoadedRelayConfig {
  const paths = resolveRelayPaths(baseDir);

  try {
    const raw = readFileSync(paths.configFile, 'utf-8');
    if (typeof raw !== 'string') {
      return emptyLoadedRelayConfig();
    }
    return parseConfigJsonl(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyLoadedRelayConfig();
    }

    throw error;
  }
}

export async function saveRelayConfig(
  paths: RelayPaths,
  records: RelayConfigRecord[],
): Promise<void> {
  await mkdir(paths.homeDir, { recursive: true });
  await writeFile(paths.configFile, serializeConfigRecords(records), 'utf-8');
}

export function upsertRecord(
  records: RelayConfigRecord[],
  nextRecord: RelayConfigRecord,
): RelayConfigRecord[] {
  const normalized = ensureDefaultRecords(records).filter((record) => {
    if (record.type !== nextRecord.type) {
      return true;
    }

    if (record.type !== 'im' || nextRecord.type !== 'im') {
      return false;
    }

    return record.id !== nextRecord.id;
  });

  return ensureDefaultRecords([...normalized, nextRecord]);
}

function resolveRuntimeDefaults(baseDir?: string): CoreConfig {
  const paths = resolveRelayPaths(baseDir);
  const loaded = readRelayConfig(baseDir);

  return {
    agentTimeoutMs: loaded.runtime.agentTimeoutMs ?? DEFAULT_RUNTIME_RECORD.config.agentTimeoutMs!,
    claudeCwd: loaded.runtime.claudeCwd ?? process.cwd(),
    stateFile: paths.stateFile,
    artifactsBaseDir: paths.artifactsDir,
    artifactRetentionDays: loaded.runtime.artifactRetentionDays ?? DEFAULT_RUNTIME_RECORD.config.artifactRetentionDays!,
    artifactMaxSizeBytes: loaded.runtime.artifactMaxSizeBytes ?? DEFAULT_RUNTIME_RECORD.config.artifactMaxSizeBytes!,
    claudeBin: loaded.runtime.claudeBin ?? DEFAULT_RUNTIME_RECORD.config.claudeBin!,
    codexBin: loaded.runtime.codexBin ?? DEFAULT_RUNTIME_RECORD.config.codexBin!,
    opencodeBin: loaded.runtime.opencodeBin ?? DEFAULT_RUNTIME_RECORD.config.opencodeBin!,
  };
}

function requireAvailableIm(
  id: AvailableIm['id'],
  baseDir?: string,
): AvailableIm {
  const loaded = readRelayConfig(baseDir);
  const selected = loaded.availableIms.find(im => im.id === id);

  if (!selected) {
    throw new Error(`Missing required ${id} configuration in ~/.agent-inbox/config.jsonl`);
  }

  return selected;
}

export function readCoreConfig(baseDir?: string): CoreConfig {
  return resolveRuntimeDefaults(baseDir);
}

export function readDiscordRelayConfig(baseDir?: string): DiscordRelayConfig {
  const coreConfig = readCoreConfig(baseDir);
  const selected = requireAvailableIm('discord', baseDir);
  const runtime = readRelayConfig(baseDir).runtime;

  if (selected.id !== 'discord') {
    throw new Error('Unexpected IM selection when reading Discord config.');
  }

  return {
    ...coreConfig,
    discordToken: selected.config.token,
    discordClientId: selected.config.clientId,
    guildIds: selected.config.guildIds ?? [],
    allowedChannelIds: selected.config.allowedChannelIds ?? [],
    streamUpdateIntervalMs: runtime.streamUpdateIntervalMs ?? DEFAULT_RUNTIME_RECORD.config.streamUpdateIntervalMs!,
    discordMessageCharLimit: runtime.discordMessageCharLimit ?? DEFAULT_RUNTIME_RECORD.config.discordMessageCharLimit!,
    maxAttachmentSizeBytes: coreConfig.artifactMaxSizeBytes,
  };
}

export function readFeishuRelayConfig(baseDir?: string): FeishuRelayConfig {
  const coreConfig = readCoreConfig(baseDir);
  const selected = requireAvailableIm('feishu', baseDir);

  if (selected.id !== 'feishu') {
    throw new Error('Unexpected IM selection when reading Feishu config.');
  }

  return {
    ...coreConfig,
    feishuAppId: selected.config.appId,
    feishuAppSecret: selected.config.appSecret,
    feishuEncryptKey: selected.config.encryptKey,
    feishuVerificationToken: selected.config.verificationToken,
    feishuBaseUrl: selected.config.baseUrl ?? 'https://open.feishu.cn',
    feishuPort: selected.config.port,
    feishuModelSelectionTimeoutMs: selected.config.modelSelectionTimeoutMs ?? 10_000,
  };
}

export function readSlackRelayConfig(baseDir?: string): SlackRelayConfig {
  const coreConfig = readCoreConfig(baseDir);
  const selected = requireAvailableIm('slack', baseDir);

  if (selected.id !== 'slack') {
    throw new Error('Unexpected IM selection when reading Slack config.');
  }

  return {
    ...coreConfig,
    slackBotToken: selected.config.botToken,
    slackAppToken: selected.config.appToken,
    slackSigningSecret: selected.config.signingSecret,
    slackSocketMode: selected.config.socketMode ?? true,
  };
}

function setNumericEnv(key: string, value: number): void {
  process.env[key] = String(value);
}

export function applyCoreConfigEnvironment(config: CoreConfig): void {
  setNumericEnv('AGENT_TIMEOUT_MS', config.agentTimeoutMs);
  delete process.env['CLAUDE_MODEL'];
  process.env['CLAUDE_CWD'] = config.claudeCwd;
  process.env['STATE_FILE'] = config.stateFile;
  process.env['ARTIFACTS_BASE_DIR'] = config.artifactsBaseDir;
  setNumericEnv('ARTIFACT_RETENTION_DAYS', config.artifactRetentionDays);
  setNumericEnv('ARTIFACT_MAX_SIZE_BYTES', config.artifactMaxSizeBytes);
  process.env['CLAUDE_BIN'] = config.claudeBin;
  process.env['CODEX_BIN'] = config.codexBin;
  process.env['OPENCODE_BIN'] = config.opencodeBin;
}

const configProxyHandler: ProxyHandler<CoreConfig> = {
  get(_target, property) {
    return readCoreConfig()[property as keyof CoreConfig];
  },
  has(_target, property) {
    return property in readCoreConfig();
  },
  ownKeys() {
    return Reflect.ownKeys(readCoreConfig());
  },
  getOwnPropertyDescriptor(_target, property) {
    const current = readCoreConfig();
    if (!(property in current)) {
      return undefined;
    }

    return {
      configurable: true,
      enumerable: true,
      value: current[property as keyof CoreConfig],
      writable: false,
    };
  },
};

export const config = new Proxy({} as CoreConfig, configProxyHandler);
