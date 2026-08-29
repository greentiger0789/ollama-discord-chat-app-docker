import assert from 'node:assert/strict';
import test, { afterEach, describe } from 'node:test';
import { Partials } from 'discord.js';
import type { RESTPostAPIApplicationCommandsJSONBody } from 'discord-api-types/v10';
import { assertDefined, assertRecord, freshImport } from '../testing/fakes.ts';

type DiscordClientModule = typeof import('../src/discordClient.ts');
type CommandPayload = { body: RESTPostAPIApplicationCommandsJSONBody[] };
interface RestCall {
    route: string;
    payload: CommandPayload;
}

const originalToken = process.env.DISCORD_TOKEN;
const originalGuildId = process.env.DISCORD_GUILD_ID;
const originalLogLevel = process.env.LOG_LEVEL;

function restoreEnv(): void {
    if (originalToken === undefined) {
        delete process.env.DISCORD_TOKEN;
    } else {
        process.env.DISCORD_TOKEN = originalToken;
    }

    if (originalGuildId === undefined) {
        delete process.env.DISCORD_GUILD_ID;
    } else {
        process.env.DISCORD_GUILD_ID = originalGuildId;
    }

    if (originalLogLevel === undefined) {
        delete process.env.LOG_LEVEL;
    } else {
        process.env.LOG_LEVEL = originalLogLevel;
    }
}

async function importFreshDiscordClient({
    token = 'mock-token',
    guildId = ''
}: {
    token?: string;
    guildId?: string;
} = {}): Promise<DiscordClientModule> {
    if (token === undefined) {
        delete process.env.DISCORD_TOKEN;
    } else {
        process.env.DISCORD_TOKEN = token;
    }
    process.env.DISCORD_GUILD_ID = guildId;

    const modulePath = new URL('../src/discordClient.ts', import.meta.url);
    return await freshImport<DiscordClientModule>(modulePath);
}

afterEach(() => {
    restoreEnv();
});

describe('discordClient exports', () => {
    test('should export client, DISCORD_TOKEN, registerCommands and createRegisterCommands', async () => {
        const mod = await importFreshDiscordClient();

        assert.ok(mod.client);
        assert.equal(mod.DISCORD_TOKEN, 'mock-token');
        assert.equal(typeof mod.registerCommands, 'function');
        assert.equal(typeof mod.createRegisterCommands, 'function');
    });

    test('client should have intents configured', async () => {
        const mod = await importFreshDiscordClient();
        assert.ok(mod.client.options.intents);
    });

    test('client should support partial reaction and message events', async () => {
        const mod = await importFreshDiscordClient();
        assertDefined(mod.client.options.partials);
        assert.ok(mod.client.options.partials.includes(Partials.Message));
        assert.ok(mod.client.options.partials.includes(Partials.Reaction));
    });
});

describe('command definitions', () => {
    test('should register o-reset and o-summary commands', async () => {
        const { createRegisterCommands } = await importFreshDiscordClient({
            guildId: '1234567890'
        });
        const captured: { payload?: CommandPayload } = {};

        const registerCommands = createRegisterCommands({
            client: {
                application: {
                    fetch: async () => ({ id: 'app-1' })
                }
            },
            guildId: '1234567890',
            restClient: {
                put: async (_route, body) => {
                    captured.payload = body;
                }
            },
            routes: {
                applicationGuildCommands: (appId, guildId) => `guild:${appId}:${guildId}`,
                applicationCommands: appId => `global:${appId}`
            }
        });

        await registerCommands();

        assertDefined(captured.payload);
        const names = captured.payload.body.map(cmd => cmd.name);
        assert.ok(names.includes('o'), 'o command should be registered');
        assert.ok(names.includes('o-reset'), 'o-reset command should be registered');
        assert.ok(names.includes('o-summary'), 'o-summary command should be registered');
    });

    test('o-reset and o-summary should have descriptions', async () => {
        const { createRegisterCommands } = await importFreshDiscordClient({
            guildId: '1234567890'
        });
        const captured: { payload?: CommandPayload } = {};

        const registerCommands = createRegisterCommands({
            client: {
                application: {
                    fetch: async () => ({ id: 'app-1' })
                }
            },
            guildId: '1234567890',
            restClient: {
                put: async (_route, body) => {
                    captured.payload = body;
                }
            },
            routes: {
                applicationGuildCommands: (appId, guildId) => `guild:${appId}:${guildId}`,
                applicationCommands: appId => `global:${appId}`
            }
        });

        await registerCommands();

        assertDefined(captured.payload);
        const resetCmd = captured.payload.body.find(cmd => cmd.name === 'o-reset');
        const summaryCmd = captured.payload.body.find(cmd => cmd.name === 'o-summary');

        assert.ok(resetCmd && 'description' in resetCmd);
        assert.ok(summaryCmd && 'description' in summaryCmd);
        assert.match(resetCmd.description, /リセット/);
        assert.match(summaryCmd.description, /要約/);
    });

    test('o command should accept one optional text attachment', async () => {
        const { createRegisterCommands } = await importFreshDiscordClient({
            guildId: '1234567890'
        });
        const captured: { payload?: CommandPayload } = {};
        const registerCommands = createRegisterCommands({
            client: { application: { fetch: async () => ({ id: 'app-1' }) } },
            guildId: '1234567890',
            restClient: {
                put: async (_route, body) => {
                    captured.payload = body;
                }
            },
            routes: {
                applicationGuildCommands: (appId, guildId) => `guild:${appId}:${guildId}`,
                applicationCommands: appId => `global:${appId}`
            }
        });

        await registerCommands();

        assertDefined(captured.payload);
        const command = captured.payload.body.find(command => command.name === 'o');
        assertDefined(command);
        assert.ok('options' in command);
        const fileOption = command.options?.[1];
        assert.deepEqual(fileOption, {
            name: 'file',
            description: 'Text file to include in the prompt',
            type: 11,
            required: false
        });
    });
});

describe('createRegisterCommands', () => {
    test('should register guild commands when DISCORD_GUILD_ID is numeric', async () => {
        const { createRegisterCommands } = await importFreshDiscordClient({
            guildId: '1234567890'
        });
        const calls: RestCall[] = [];

        const registerCommands = createRegisterCommands({
            client: {
                application: {
                    fetch: async () => ({ id: 'app-1' })
                }
            },
            guildId: '1234567890',
            restClient: {
                put: async (route, payload) => {
                    calls.push({ route, payload });
                }
            },
            routes: {
                applicationGuildCommands: (appId, guildId) => `guild:${appId}:${guildId}`,
                applicationCommands: appId => `global:${appId}`
            }
        });

        await registerCommands();

        assert.equal(calls.length, 1);
        assertDefined(calls[0]);
        assert.equal(calls[0].route, 'guild:app-1:1234567890');
        assert.ok(Array.isArray(calls[0].payload.body));
        assertDefined(calls[0].payload.body[0]);
        assert.equal(calls[0].payload.body[0].name, 'o');
    });

    test('should register global commands when guild ID is absent', async () => {
        const { createRegisterCommands } = await importFreshDiscordClient();
        const calls: RestCall[] = [];

        const registerCommands = createRegisterCommands({
            client: {
                application: {
                    fetch: async () => ({ id: 'app-2' })
                }
            },
            guildId: '',
            restClient: {
                put: async (route, payload) => {
                    calls.push({ route, payload });
                }
            },
            routes: {
                applicationGuildCommands: (appId, guildId) => `guild:${appId}:${guildId}`,
                applicationCommands: appId => `global:${appId}`
            }
        });

        await registerCommands();

        assert.equal(calls.length, 1);
        assertDefined(calls[0]);
        assert.equal(calls[0].route, 'global:app-2');
        assert.ok(Array.isArray(calls[0].payload.body));
    });

    test('should fall back to global registration when guild ID is invalid', async () => {
        const { createRegisterCommands } = await importFreshDiscordClient({
            guildId: 'not-a-number'
        });
        const calls: RestCall[] = [];

        const registerCommands = createRegisterCommands({
            client: {
                application: {
                    fetch: async () => ({ id: 'app-3' })
                }
            },
            guildId: 'not-a-number',
            restClient: {
                put: async (route, payload) => {
                    calls.push({ route, payload });
                }
            },
            routes: {
                applicationGuildCommands: (appId, guildId) => `guild:${appId}:${guildId}`,
                applicationCommands: appId => `global:${appId}`
            }
        });

        await registerCommands();

        assert.equal(calls.length, 1);
        assertDefined(calls[0]);
        assert.equal(calls[0].route, 'global:app-3');
    });

    test('should log an error when the Discord application is not ready', async () => {
        const { createRegisterCommands } = await importFreshDiscordClient();
        const originalConsoleError = console.error;
        const logged: unknown[][] = [];
        let putCalled = false;
        process.env.LOG_LEVEL = 'error';

        console.error = (...args) => {
            logged.push(args);
        };

        try {
            const registerCommands = createRegisterCommands({
                client: {},
                restClient: {
                    put: async () => {
                        putCalled = true;
                    }
                }
            });

            await registerCommands();
        } finally {
            console.error = originalConsoleError;
        }

        assert.equal(putCalled, false);
        assert.equal(logged.length, 1);
        assertDefined(logged[0]);
        assert.match(String(logged[0][0]), /Failed to register commands/);
        assert.ok(logged[0][1] instanceof Error);
        assert.match(logged[0][1].message, /Discord application is not ready/);
        assertRecord(logged[0][2]);
        assert.equal(logged[0][2].scope, 'discordClient');
    });
});

describe('discordClient without token', () => {
    test('should attempt to exit when DISCORD_TOKEN is empty', async () => {
        const originalExit = process.exit;
        let exitCalled = false;

        process.exit = code => {
            exitCalled = true;
            throw new Error(`process.exit(${code}) called`);
        };

        try {
            await importFreshDiscordClient({ token: '' });
        } catch {
            // process.exit is mocked to throw in this test.
        } finally {
            process.exit = originalExit;
        }

        assert.equal(exitCalled, true);
    });
});
