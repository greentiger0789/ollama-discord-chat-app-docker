import { REST } from '@discordjs/rest';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { type RESTPostAPIApplicationCommandsJSONBody, Routes } from 'discord-api-types/v10';
import './loadEnv.ts';
import { createLogger } from './logger.ts';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const logger = createLogger('discordClient');

if (!DISCORD_TOKEN) {
    logger.error('DISCORD_TOKEN is required');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Reaction]
});

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

export const commands = [
    {
        name: 'o',
        description: 'Send prompt to Ollama',
        options: [
            {
                name: 'prompt',
                description: 'Prompt to send',
                type: 3,
                required: true
            },
            {
                name: 'file',
                description: 'Text file to include in the prompt',
                type: 11,
                required: false
            }
        ]
    },
    {
        name: 'o-reset',
        description: 'このスレッドの会話履歴をリセットします'
    },
    {
        name: 'o-summary',
        description: 'これまでの会話の要約を出力します'
    }
] satisfies RESTPostAPIApplicationCommandsJSONBody[];

interface DiscordApplicationPort {
    id?: string;
    fetch?(): Promise<{ id?: string }>;
}

interface DiscordClientPort {
    application?: DiscordApplicationPort | null;
}

interface RestClientPort {
    put(
        route: string,
        options: { body: RESTPostAPIApplicationCommandsJSONBody[] }
    ): Promise<unknown>;
}

interface RoutesPort {
    applicationCommands(applicationId: string): string;
    applicationGuildCommands(applicationId: string, guildId: string): string;
}

interface RegisterCommandDependencies {
    client?: DiscordClientPort;
    restClient?: RestClientPort;
    guildId?: string | undefined;
    routes?: RoutesPort;
    commandList?: RESTPostAPIApplicationCommandsJSONBody[];
}

export function createRegisterCommands({
    client: discordClient = client,
    restClient = rest,
    guildId = GUILD_ID,
    routes = Routes,
    commandList = commands
}: RegisterCommandDependencies = {}) {
    return async function registerCommands(): Promise<void> {
        try {
            const app =
                typeof discordClient.application?.fetch === 'function'
                    ? await discordClient.application.fetch()
                    : discordClient.application;
            const appId = app?.id;

            if (!appId) {
                throw new Error('Discord application is not ready');
            }

            if (guildId && /^[0-9]+$/.test(guildId)) {
                logger.info('Registering commands to guild', {
                    guildId,
                    commandCount: commandList.length
                });
                await restClient.put(routes.applicationGuildCommands(appId, guildId), {
                    body: commandList
                });
                logger.info('Registered commands to guild', {
                    guildId,
                    commandCount: commandList.length
                });
                return;
            }

            if (guildId) {
                logger.warn('DISCORD_GUILD_ID is invalid. Falling back to global commands.', {
                    guildId
                });
            }

            logger.info('Registering global commands', {
                commandCount: commandList.length
            });
            await restClient.put(routes.applicationCommands(appId), { body: commandList });
            logger.info('Registered global commands', {
                commandCount: commandList.length
            });
        } catch (err) {
            logger.error('Failed to register commands', err, {
                guildId: guildId || null
            });
        }
    };
}

export const registerCommands = createRegisterCommands();

export { client, DISCORD_TOKEN };
