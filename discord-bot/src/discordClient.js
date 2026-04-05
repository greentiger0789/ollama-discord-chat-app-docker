import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { Client, GatewayIntentBits } from 'discord.js';
import './loadEnv.js';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!DISCORD_TOKEN) {
    console.error('DISCORD_TOKEN is required');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

const commands = [
    {
        name: 'o',
        description: 'Send prompt to Ollama',
        options: [
            {
                name: 'prompt',
                description: 'Prompt to send',
                type: 3,
                required: true
            }
        ]
    }
];

export function createRegisterCommands({
    client: discordClient = client,
    restClient = rest,
    guildId = GUILD_ID,
    routes = Routes,
    commandList = commands
} = {}) {
    return async function registerCommands() {
        try {
            const app = typeof discordClient.application?.fetch === 'function'
                ? await discordClient.application.fetch()
                : discordClient.application;
            const appId = app?.id;

            if (!appId) {
                throw new Error('Discord application is not ready');
            }

            if (guildId && /^[0-9]+$/.test(guildId)) {
                await restClient.put(
                    routes.applicationGuildCommands(appId, guildId),
                    { body: commandList }
                );
                console.log('Registered commands to guild', guildId);
                return;
            }

            await restClient.put(
                routes.applicationCommands(appId),
                { body: commandList }
            );
            console.log('Registered global commands');
        } catch (err) {
            console.error('Failed to register commands', err);
        }
    };
}

export const registerCommands = createRegisterCommands();

export { client, DISCORD_TOKEN };
