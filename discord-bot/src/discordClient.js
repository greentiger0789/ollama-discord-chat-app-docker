import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { Client, GatewayIntentBits } from 'discord.js';
import 'dotenv/config';

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

export async function registerCommands() {
    try {
        const app = await client.application?.fetch();
        const appId = app.id;

        if (GUILD_ID && /^[0-9]+$/.test(GUILD_ID)) {
            await rest.put(
                Routes.applicationGuildCommands(appId, GUILD_ID),
                { body: commands }
            );
            console.log('Registered commands to guild', GUILD_ID);
        } else {
            await rest.put(
                Routes.applicationCommands(appId),
                { body: commands }
            );
            console.log('Registered global commands');
        }
    } catch (err) {
        console.error('Failed to register commands', err);
    }
}

export { client, DISCORD_TOKEN };
