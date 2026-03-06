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
  persistState,
  type BackendName,
} from '@agent-im-relay/core';

export const BACKEND_SELECT_ID = 'thread_setup:backend';

export type SetupResult = {
  backend: BackendName;
  cwd: string | null;
};

function buildBackendMenu(): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(BACKEND_SELECT_ID)
      .setPlaceholder('选择 AI Backend')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('Claude (Claude Code)')
          .setValue('claude')
          .setDescription('Anthropic Claude Code CLI'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Codex (OpenAI Codex)')
          .setValue('codex')
          .setDescription('OpenAI Codex CLI'),
      ),
  );
}

const SETUP_TIMEOUT_MS = 60_000;

export async function promptThreadSetup(
  thread: AnyThreadChannel,
  prompt: string,
): Promise<SetupResult> {
  const msg = await thread.send({
    content: `**选择 AI Backend**\n> ${prompt.slice(0, 200)}`,
    components: [buildBackendMenu()],
  });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      void msg.edit({ content: '⏰ 超时，使用默认配置：Claude', components: [] });
      resolve({ backend: 'claude', cwd: null });
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
      clearTimeout(timer);
      collector.stop();
      await msg.edit({
        content: `✅ Backend: **${selectedBackend}**`,
        components: [],
      });
      resolve({ backend: selectedBackend, cwd: null });
    });
  });
}

export async function applySetupResult(
  threadId: string,
  result: SetupResult,
): Promise<void> {
  conversationBackend.set(threadId, result.backend);
  if (result.cwd) {
    conversationCwd.set(threadId, result.cwd);
  }
  void persistState();
}
