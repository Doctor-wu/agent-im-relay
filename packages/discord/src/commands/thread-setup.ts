import {
  ActionRowBuilder,
  ComponentType,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type AnyThreadChannel,
} from 'discord.js';
import {
  conversationBackend,
  conversationCwd,
  conversationModels,
  getAvailableBackendCapabilities,
  persistState,
  resolveBackendModelId,
  type AgentBackendCapability,
  type BackendModel,
  type BackendName,
} from '@agent-im-relay/core';

export const BACKEND_SELECT_ID = 'thread_setup:backend';
export const MODEL_SELECT_ID = 'thread_setup:model';

export type SetupResult = {
  backend: BackendName;
  model: string | null;
  cwd: string | null;
};

export type ThreadSetupOptions = {
  presetBackend?: BackendName;
};

function describeBackend(backend: BackendName): { label: string; description: string } {
  if (backend === 'claude') {
    return {
      label: 'Claude (Claude Code)',
      description: 'Anthropic Claude Code CLI',
    };
  }

  if (backend === 'codex') {
    return {
      label: 'Codex (OpenAI Codex)',
      description: 'OpenAI Codex CLI',
    };
  }

  if (backend === 'opencode') {
    return {
      label: 'OpenCode',
      description: 'OpenCode CLI',
    };
  }

  return {
    label: backend,
    description: `${backend} CLI`,
  };
}

function buildBackendMenu(backends: AgentBackendCapability[]): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(BACKEND_SELECT_ID)
      .setPlaceholder('选择 AI Backend')
      .addOptions(backends.map((backend) => {
        const details = describeBackend(backend.name);
        return new StringSelectMenuOptionBuilder()
          .setLabel(details.label)
          .setValue(backend.name)
          .setDescription(details.description);
      })),
  );
}

function buildModelMenu(models: BackendModel[]): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(MODEL_SELECT_ID)
      .setPlaceholder('选择 Model')
      .addOptions(models.slice(0, 25).map(model => new StringSelectMenuOptionBuilder()
        .setLabel(model.label)
        .setValue(model.id))),
  );
}

const SETUP_TIMEOUT_MS = 60_000;

function resolveFallbackModel(
  threadId: string,
  backend: BackendName,
  models: BackendModel[],
): string | null {
  const savedModel = conversationModels.get(threadId);
  const normalizedModel = savedModel
    ? resolveBackendModelId(backend, savedModel)
    : undefined;

  return normalizedModel ?? models[0]?.id ?? null;
}

async function promptThreadModelSetup(options: {
  thread: AnyThreadChannel;
  threadId: string;
  message: Awaited<ReturnType<AnyThreadChannel['send']>>;
  backend: BackendName;
  models: BackendModel[];
  finish: (result: SetupResult | null) => void;
  initialRender?: boolean;
}): Promise<void> {
  if (options.initialRender) {
    await options.message.edit({
      content: `**选择 Model**\nBackend: **${options.backend}**`,
      components: [buildModelMenu(options.models)],
    });
  }

  const modelCollector = options.message.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    max: 1,
    filter: candidate => candidate.customId === MODEL_SELECT_ID,
    time: SETUP_TIMEOUT_MS,
  });

  modelCollector.on('collect', async (modelInteraction) => {
    await modelInteraction.deferUpdate();
    const selectedModel = modelInteraction.values[0] ?? null;
    modelCollector.stop('selected');
    await options.message.edit({
      content: `✅ Backend: **${options.backend}**\n✅ Model: **${selectedModel}**`,
      components: [],
    });
    options.finish({ backend: options.backend, model: selectedModel, cwd: null });
  });

  modelCollector.on('end', async (_interactions, reason) => {
    if (reason !== 'time') {
      return;
    }

    const fallbackModel = resolveFallbackModel(options.threadId, options.backend, options.models);
    if (!fallbackModel) {
      await options.message.edit({
        content: '⏰ Model 选择超时，请重新开始 setup。',
        components: [],
      });
      options.finish(null);
      return;
    }

    await options.message.edit({
      content: `⏰ Model 选择超时，使用默认 Model：**${fallbackModel}**。`,
      components: [],
    });
    options.finish({ backend: options.backend, model: fallbackModel, cwd: null });
  });
}

export async function promptThreadSetup(
  thread: AnyThreadChannel,
  prompt: string,
  options: ThreadSetupOptions = {},
): Promise<SetupResult | null> {
  const availableBackends = await getAvailableBackendCapabilities();
  const fallbackBackend = availableBackends[0];
  if (!fallbackBackend) {
    throw new Error('No available backends detected.');
  }

  const presetCapability = options.presetBackend
    ? availableBackends.find(backend => backend.name === options.presetBackend)
    : undefined;
  if (presetCapability && presetCapability.models.length === 0) {
    return {
      backend: presetCapability.name,
      model: null,
      cwd: null,
    };
  }

  const msg = await thread.send({
    content: presetCapability
      ? `**选择 Model**\nBackend: **${presetCapability.name}**`
      : `**选择 AI Backend**\n> ${prompt.slice(0, 200)}`,
    components: presetCapability
      ? [buildModelMenu(presetCapability.models)]
      : [buildBackendMenu(availableBackends)],
  });

  return new Promise((resolve) => {
    let settled = false;
    let backendTimer: ReturnType<typeof setTimeout> | undefined;
    const fallbackResult: SetupResult = {
      backend: fallbackBackend.name,
      model: null,
      cwd: null,
    };
    const finish = (result: SetupResult | null) => {
      if (settled) {
        return;
      }

      settled = true;
      if (backendTimer) {
        clearTimeout(backendTimer);
      }
      resolve(result);
    };

    if (presetCapability) {
      void promptThreadModelSetup({
        thread,
        threadId: thread.id,
        message: msg,
        backend: presetCapability.name,
        models: presetCapability.models,
        finish,
      });
      return;
    }

    backendTimer = setTimeout(() => {
      if (fallbackBackend.models.length > 0) {
        void msg.edit({ content: '⏰ 超时，请重新选择 Backend 和 Model。', components: [] });
        finish(null);
        return;
      }

      void msg.edit({ content: '⏰ 超时，使用默认配置。', components: [] });
      finish(fallbackResult);
    }, SETUP_TIMEOUT_MS);

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      max: 1,
      filter: (interaction) => interaction.customId === BACKEND_SELECT_ID,
      time: SETUP_TIMEOUT_MS,
    });

    collector.on('collect', async (interaction) => {
      await interaction.deferUpdate();
      const selectedBackend = interaction.values[0] as BackendName;
      collector.stop();
      clearTimeout(backendTimer);
      const capability = availableBackends.find(backend => backend.name === selectedBackend);
      const models = capability?.models ?? [];

      if (models.length === 0) {
        await msg.edit({
          content: `✅ Backend: **${selectedBackend}**`,
          components: [],
        });
        finish({ backend: selectedBackend, model: null, cwd: null });
        return;
      }

      void promptThreadModelSetup({
        thread,
        threadId: thread.id,
        message: msg,
        backend: selectedBackend,
        models,
        finish,
        initialRender: true,
      });
    });
  });
}

export async function applySetupResult(
  threadId: string,
  result: SetupResult,
): Promise<void> {
  conversationBackend.set(threadId, result.backend);
  if (result.model) {
    conversationModels.set(threadId, result.model);
  } else {
    conversationModels.delete(threadId);
  }
  if (result.cwd) {
    conversationCwd.set(threadId, result.cwd);
  }
  void persistState('discord');
}
