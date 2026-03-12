import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { RelayPaths } from '@agent-im-relay/core';

export type RuntimeConfig = {
  agentTimeoutMs?: number;
  artifactRetentionDays?: number;
  artifactMaxSizeBytes?: number;
  streamUpdateIntervalMs?: number;
  discordMessageCharLimit?: number;
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
  lastUsedPlatform?: 'discord' | 'feishu';
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

export type AppConfigRecord =
  | MetaRecord
  | RuntimeRecord
  | LocalPreferencesRecord
  | DiscordImRecord
  | FeishuImRecord;

export type AvailableIm =
  | {
    id: 'discord';
    note?: string;
    config: Required<Pick<DiscordImConfig, 'token' | 'clientId'>> & Pick<DiscordImConfig, 'guildIds' | 'allowedChannelIds'>;
  }
  | {
    id: 'feishu';
    note?: string;
    config: Required<Pick<FeishuImConfig, 'appId' | 'appSecret'>> & Pick<FeishuImConfig, 'verificationToken' | 'encryptKey' | 'baseUrl' | 'port'>;
  };

export interface LoadedAppConfig {
  records: AppConfigRecord[];
  availableIms: AvailableIm[];
  runtime: RuntimeConfig;
  lastUsedPlatform?: AvailableIm['id'];
  errors: string[];
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
  return value === 'discord' || value === 'feishu' ? value : undefined;
}

function normalizeRuntimeRecord(
  value: Record<string, unknown>,
): RuntimeRecord {
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
    },
  };
}

function parseConfigRecord(value: unknown, lineNumber: number): {
  record?: AppConfigRecord;
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

    return { error: `Line ${lineNumber}: unsupported im id "${String(value.id)}".` };
  }

  return { error: `Line ${lineNumber}: unsupported record type "${String(value.type)}".` };
}

export function parseConfigJsonl(input: string): LoadedAppConfig {
  const records: AppConfigRecord[] = [];
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

  return {
    records: ensureDefaultRecords(records),
    availableIms: resolveAvailableIms(records),
    runtime: resolveRuntimeConfig(records),
    lastUsedPlatform: resolveLastUsedPlatform(records),
    errors,
  };
}

export function ensureDefaultRecords(records: AppConfigRecord[]): AppConfigRecord[] {
  const nextRecords = [...records];

  if (!nextRecords.some(record => record.type === 'meta')) {
    nextRecords.unshift(DEFAULT_META_RECORD);
  }

  if (!nextRecords.some(record => record.type === 'runtime')) {
    nextRecords.push(DEFAULT_RUNTIME_RECORD);
  }

  return nextRecords;
}

export function resolveRuntimeConfig(records: AppConfigRecord[]): RuntimeConfig {
  const runtimeRecord = records.find((record): record is RuntimeRecord => record.type === 'runtime');
  return {
    ...DEFAULT_RUNTIME_RECORD.config,
    ...(runtimeRecord?.config ?? {}),
  };
}

export function resolveLastUsedPlatform(
  records: AppConfigRecord[],
): AvailableIm['id'] | undefined {
  return records.find(
    (record): record is LocalPreferencesRecord => record.type === 'local-preferences',
  )?.lastUsedPlatform;
}

export function resolveAvailableIms(records: AppConfigRecord[]): AvailableIm[] {
  const ims = records.filter((record): record is DiscordImRecord | FeishuImRecord => record.type === 'im');

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
      },
    }];
  });
}

export async function loadAppConfig(paths: RelayPaths): Promise<LoadedAppConfig> {
  try {
    const raw = await readFile(paths.configFile, 'utf-8');
    return parseConfigJsonl(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        records: ensureDefaultRecords([]),
        availableIms: [],
        runtime: resolveRuntimeConfig([]),
        lastUsedPlatform: undefined,
        errors: [],
      };
    }

    throw error;
  }
}

export function serializeConfigRecords(records: AppConfigRecord[]): string {
  return `${ensureDefaultRecords(records).map(record => JSON.stringify(record)).join('\n')}\n`;
}

export async function saveAppConfig(paths: RelayPaths, records: AppConfigRecord[]): Promise<void> {
  await mkdir(paths.homeDir, { recursive: true });
  await writeFile(paths.configFile, serializeConfigRecords(records), 'utf-8');
}

export function upsertRecord(records: AppConfigRecord[], nextRecord: AppConfigRecord): AppConfigRecord[] {
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
