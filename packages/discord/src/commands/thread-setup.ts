import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type AnyThreadChannel,
  type MessageComponentInteraction,
} from 'discord.js';
import {
  conversationBackend,
  conversationCwd,
  savedCwdList,
  persistState,
  type BackendName,
} from '@agent-im-relay/core';

export const BACKEND_SELECT_ID = 'thread_setup:backend';
export const CWD_SELECT_ID = 'thread_setup:cwd';
export const START_BUTTON_ID = 'thread_setup:start';
export const AGENT_FIND_CWD = '__agent_find__';

export type SetupResult = {
  backend: BackendName;
  cwd: string | null; // null = agent finds it
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

function buildCwdMenu(): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = savedCwdList.map((dir) =>
    new StringSelectMenuOptionBuilder().setLabel(dir).setValue(dir),
  );
  options.push(
    new StringSelectMenuOptionBuilder()
      .setLabel('让 Agent 自己找')
      .setValue(AGENT_FIND_CWD)
      .setDescription('Agent 将自动定位项目目录'),
  );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CWD_SELECT_ID)
      .setPlaceholder('选择工作目录')
      .addOptions(options),
  );
}

function buildStartButton(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(START_BUTTON_ID)
      .setLabel('开始')
      .setStyle(ButtonStyle.Primary),
  );
}

const SETUP_TIMEOUT_MS = 60_000;

export async function promptThreadSetup(
  thread: AnyThreadChannel,
  prompt: string,
): Promise<SetupResult> {
  const msg = await thread.send({
    content: `**选择配置后点击「开始」**\n> ${prompt.slice(0, 200)}`,
    components: [buildBackendMenu(), buildCwdMenu(), buildStartButton()],
  });

  let selectedBackend: BackendName = 'claude';
  let selectedCwd: string | null = null;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      void msg.edit({ content: '⏰ 超时，使用默认配置：Claude + 让 Agent 自己找', components: [] });
      resolve({ backend: 'claude', cwd: null });
    }, SETUP_TIMEOUT_MS);

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: SETUP_TIMEOUT_MS,
    });

    const buttonCollector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (i: MessageComponentInteraction) => i.customId === START_BUTTON_ID,
      time: SETUP_TIMEOUT_MS,
    });

    collector.on('collect', async (interaction) => {
      await interaction.deferUpdate();
      if (interaction.customId === BACKEND_SELECT_ID) {
        selectedBackend = interaction.values[0] as BackendName;
      } else if (interaction.customId === CWD_SELECT_ID) {
        selectedCwd = interaction.values[0] === AGENT_FIND_CWD ? null : interaction.values[0];
      }
    });

    buttonCollector.on('collect', async (interaction) => {
      await interaction.deferUpdate();
      clearTimeout(timer);
      collector.stop();
      buttonCollector.stop();
      const cwdLabel = selectedCwd ?? '让 Agent 自己找';
      await msg.edit({
        content: `✅ Backend: **${selectedBackend}** | 工作目录: **${cwdLabel}**`,
        components: [],
      });
      resolve({ backend: selectedBackend, cwd: selectedCwd });
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
