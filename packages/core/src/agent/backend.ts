import { spawnSync } from 'node:child_process';
import type { AgentSessionOptions, AgentStreamEvent } from './session.js';

export type BackendName = string;

export interface BackendModel {
  id: string;
  label: string;
}

export interface AgentBackendCapability {
  name: BackendName;
  models: BackendModel[];
}

type BackendModelResolutionOptions = {
  allowCompatibility?: boolean;
};

export interface AgentBackend {
  readonly name: BackendName;
  isAvailable(): boolean | Promise<boolean>;
  listModels?(): BackendModel[];
  stream(options: AgentSessionOptions): AsyncGenerator<AgentStreamEvent, void>;
}

const registry = new Map<BackendName, AgentBackend>();
const CLAUDE_COMPATIBLE_MODEL_PATTERNS = [
  /^claude-(?:opus|sonnet|haiku)-\d(?:-\d+)*(?:-(?:latest|\d{8}))?$/,
  /^claude-\d(?:-\d+)*-(?:opus|sonnet|haiku)(?:-(?:latest|\d{8}))?$/,
];

export function registerBackend(backend: AgentBackend): void {
  registry.set(backend.name, backend);
}

export function getBackend(name: BackendName): AgentBackend {
  const backend = registry.get(name);
  if (!backend) throw new Error(`Unknown backend: ${name}`);
  return backend;
}

export function getRegisteredBackendNames(): BackendName[] {
  return [...registry.keys()];
}

export function isRegisteredBackendName(name: string): name is BackendName {
  return registry.has(name);
}

export async function getAvailableBackends(): Promise<AgentBackend[]> {
  const backends = [...registry.values()];
  const availability = await Promise.all(backends.map(async backend => ({
    backend,
    available: await backend.isAvailable(),
  })));

  return availability
    .filter(result => result.available)
    .map(result => result.backend);
}

export async function getAvailableBackendNames(): Promise<BackendName[]> {
  return (await getAvailableBackends()).map(backend => backend.name);
}

function normalizeBackendModels(models: BackendModel[]): BackendModel[] {
  const deduped = new Map<string, BackendModel>();

  for (const model of models) {
    const id = model.id.trim();
    if (!id || deduped.has(id)) {
      continue;
    }

    deduped.set(id, {
      id,
      label: model.label.trim() || id,
    });
  }

  return [...deduped.values()];
}

export function getBackendSupportedModels(name: BackendName): BackendModel[] {
  try {
    const models = getBackend(name).listModels?.() ?? [];
    return normalizeBackendModels(models);
  } catch {
    return [];
  }
}

export async function getAvailableBackendCapabilities(): Promise<AgentBackendCapability[]> {
  const backends = await getAvailableBackends();
  return backends.map(backend => ({
    name: backend.name,
    models: getBackendSupportedModels(backend.name),
  }));
}

function resolveCompatibleBackendModelId(
  name: BackendName,
  requestedModel: string,
  models: BackendModel[],
): string | undefined {
  if (
    name === 'claude'
    && CLAUDE_COMPATIBLE_MODEL_PATTERNS.some(pattern => pattern.test(requestedModel))
  ) {
    return requestedModel;
  }

  if (name === 'opencode') {
    const suffixMatches = models.filter(candidate => candidate.id.endsWith(`/${requestedModel}`));
    if (suffixMatches.length === 1) {
      return suffixMatches[0]!.id;
    }
  }

  return undefined;
}

export function resolveBackendModelId(
  name: BackendName,
  model: string,
  options: BackendModelResolutionOptions = {},
): string | undefined {
  const requestedModel = model.trim();
  if (!requestedModel) {
    return undefined;
  }

  const models = getBackendSupportedModels(name);
  if (models.length === 0) {
    return undefined;
  }

  const exactMatch = models.find(candidate => candidate.id === requestedModel);
  if (exactMatch) {
    return exactMatch.id;
  }

  if (options.allowCompatibility ?? true) {
    const compatibleMatch = resolveCompatibleBackendModelId(name, requestedModel, models);
    if (compatibleMatch) {
      return compatibleMatch;
    }
  }

  return undefined;
}

export function isBackendModelSupported(
  name: BackendName,
  model: string,
  options: BackendModelResolutionOptions = {},
): boolean {
  const requestedModel = model.trim();
  if (!requestedModel) {
    return false;
  }

  const models = getBackendSupportedModels(name);
  if (models.length === 0) {
    return false;
  }

  if (models.some(candidate => candidate.id === requestedModel)) {
    return true;
  }

  if (!(options.allowCompatibility ?? false)) {
    return false;
  }

  return resolveCompatibleBackendModelId(name, requestedModel, models) !== undefined;
}

export function resetBackendRegistryForTests(): void {
  registry.clear();
}

export function isBackendCommandAvailable(command: string): boolean {
  const result = spawnSync(command, ['--help'], { stdio: 'ignore' });
  return !result.error;
}
