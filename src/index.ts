import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { config } from './config.js';
import { askCommand, handleAskCommand } from './commands/ask.js';
import { codeCommand, handleCodeCommand } from './commands/code.js';

type CommandHandler = (interaction: ChatInputCommandInteraction) => Promise<void>;

const commandHandlers = new Map<string, CommandHandler>([
  ['code', handleCodeCommand],
  ['ask', handleAskCommand],
]);

const commandDefinitions = [codeCommand, askCommand];

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

const rest = new REST({ version: '10' }).setToken(config.discordToken);

async function registerSlashCommands(): Promise<void> {
  const body = commandDefinitions.map((command) => command.toJSON());

  if (config.guildIds.length > 0) {
    await Promise.all(
      config.guildIds.map(async (guildId) => {
        await rest.put(Routes.applicationGuildCommands(config.discordClientId, guildId), { body });
      }),
    );
    console.log(`Registered slash commands for ${config.guildIds.length} guild(s).`);
    return;
  }

  await rest.put(Routes.applicationCommands(config.discordClientId), { body });
  console.log('Registered global slash commands.');
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`Received ${signal}. Shutting down...`);
  client.destroy();
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  await registerSlashCommands();
});

client.rest.on('rateLimited', (rateLimitData) => {
  console.warn(`Discord rate limit hit on ${rateLimitData.route}`);
});

client.on(Events.Error, (error) => {
  console.error('Discord client error:', error);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const handler = commandHandlers.get(interaction.commandName);
  if (!handler) return;

  try {
    await handler(interaction);
  } catch (error) {
    const errorText = toErrorMessage(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: `Unexpected error: ${errorText}`, ephemeral: true });
    } else {
      await interaction.reply({ content: `Unexpected error: ${errorText}`, ephemeral: true });
    }
  }
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

void client.login(config.discordToken);
