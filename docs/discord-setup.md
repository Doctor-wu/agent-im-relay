# Discord Setup

This guide walks through the Discord-specific setup for Agent Inbox.

Before you start, install at least one supported backend CLI on the machine where Agent Inbox will run:

- `claude` for Claude Code
- `codex` for OpenAI Codex

Agent Inbox executes the selected backend locally. By default it looks for `claude` and `codex` in your `PATH`.

Agent Inbox expects three Discord values:

- `token`: your bot token
- `clientId`: your Discord application client ID
- `guildIds` (optional): one or more Discord server IDs for guild-scoped slash command registration

This project is designed for guild channels and threads, not direct messages.

## 1. Create a Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application**.
3. Enter a name for your bot and create the application.

You can keep the default application settings for now.

## 2. Add a bot user

1. Open the application you just created.
2. Go to **Bot**.
3. Click **Add Bot** if Discord has not created one yet.
4. Generate or reset the bot token, then copy it somewhere safe.

Treat the bot token like a password. Anyone with this token can control your bot.

## 3. Enable the required intent

Agent Inbox listens for guild mentions and follow-up replies inside Discord threads. The current implementation requests:

- `Guilds`
- `GuildMessages`
- `MessageContent`

In the Developer Portal:

1. Go to **Bot**.
2. Find **Privileged Gateway Intents**.
3. Enable **Message Content Intent**.

Without Message Content Intent, slash commands can still register, but mention-driven sessions will not work correctly.

## 4. Invite the app to your server

Open **OAuth2** and create a guild install invite for the app.

Use these scopes:

- `bot`
- `applications.commands`

Recommended bot permissions for Agent Inbox's current Discord workflow:

- View Channels
- Send Messages
- Create Public Threads
- Send Messages in Threads
- Read Message History
- Attach Files
- Add Reactions

These permissions are based on the current implementation:

- the bot posts seed messages in a channel
- it starts a new thread for `/code` or `@mention` sessions
- it streams replies in threads
- it uploads artifacts back to Discord
- it reacts to incoming messages with status markers

After selecting the scopes and permissions, open the generated invite URL and add the app to your target server.

## 5. Collect the values for Agent Inbox

You need:

- Bot token: from **Bot**
- Client ID: from **General Information** or **OAuth2**
- Optional guild IDs: server IDs where you want slash commands registered as guild commands

If you want to use `guildIds`, enable Developer Mode in Discord and copy the server ID for each target guild.

Use `guildIds` when you want command updates to appear immediately in a specific server. Leave it empty if you prefer global command registration.

## 6. Configure Agent Inbox

Run the CLI:

```bash
agent-inbox
```

On first run, choose **Discord** in the interactive setup flow and enter:

- bot token
- application client ID
- optional comma-separated guild IDs

Agent Inbox stores the result in `~/.agent-inbox/config.jsonl`.

Example record:

```jsonc
{"type":"im","id":"discord","enabled":true,"config":{"token":"your-bot-token","clientId":"your-client-id","guildIds":["your-guild-id"]}}
```

## 7. Start the relay and verify it

Start Agent Inbox:

```bash
agent-inbox
```

Then verify the Discord side:

1. Open the server where you invited the bot.
2. Run `/code` to create a working thread, or run `/ask` for a quick reply in the current channel.
3. Mention the bot in a guild text channel if you want the bot to open a thread-backed session from a message.
4. Confirm the bot streams its response in the expected place.

## Troubleshooting

### Slash commands do not appear

- Confirm the app was invited with the `applications.commands` scope.
- If you left `guildIds` empty, remember that global commands can take longer to propagate than guild commands.
- Restart Agent Inbox after changing `clientId` or `guildIds`.

### Mentions do not trigger anything

- Confirm **Message Content Intent** is enabled in the Developer Portal.
- Make sure you are testing in a guild channel, not a DM.
- Check that the bot has permission to view and send messages in that channel.

### The bot cannot create or reply in threads

- Confirm the bot has **Create Public Threads** and **Send Messages in Threads**.
- Confirm the bot can read message history in the channel.

## References

- [Discord Application Commands documentation](https://docs.discord.com/developers/docs/interactions/application-commands)
- [Discord Message Content Privileged Intent FAQ](https://support-dev.discord.com/hc/en-us/articles/4404772028055-Message-Content-Privileged-Intent-FAQ)
