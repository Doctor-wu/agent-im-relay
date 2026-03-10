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
  type AgentBackendCapability,
  type BackendName,
} from '@agent-im-relay/core';

export const BACKEND_SELECT_ID = 'thread_setup:backend';

export type SetupResult = {
  backend: BackendName;
  model: string | null;
  cwd: string | null;
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

const SETUP_TIMEOUT_MS = 60_000;

export async function promptThreadSetup(
  thread: AnyThreadChannel,
  prompt: string,
): Promise<SetupResult | null> {
  const availableBackends = await getAvailableBackendCapabilities();
  const fallbackBackend = availableBackends[0];
  if (!fallbackBackend) {
    throw new Error('No available backends detected.');
  }

  const msg = await thread.send({
    content: `**选择 AI Backend**\n> ${prompt.slice(0, 200)}`,
    components: [buildBackendMenu(availableBackends)],
  });

  return new Promise((resolve) => {
    let settled = false;
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
      clearTimeout(backendTimer);
      resolve(result);
    };

    const backendTimer = setTimeout(() => {
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

      await msg.edit({
        content: `✅ Backend: **${selectedBackend}**`,
        components: [],
      });
      finish({ backend: selectedBackend, model: null, cwd: null });
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
