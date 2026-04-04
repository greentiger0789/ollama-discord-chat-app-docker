import assert from "node:assert/strict";
import test, { afterEach, describe } from "node:test";

const originalToken = process.env.DISCORD_TOKEN;
const originalGuildId = process.env.DISCORD_GUILD_ID;

function restoreEnv() {
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
}

async function importFreshDiscordClient({ token = "mock-token", guildId = "" } = {}) {
    if (token === undefined) {
        delete process.env.DISCORD_TOKEN;
    } else {
        process.env.DISCORD_TOKEN = token;
    }
    process.env.DISCORD_GUILD_ID = guildId;

    const modulePath = new URL("../src/discordClient.js", import.meta.url);
    return await import(`${modulePath.href}?t=${Date.now()}-${Math.random()}`);
}

afterEach(() => {
    restoreEnv();
});

describe("discordClient exports", () => {
    test("should export client, DISCORD_TOKEN, registerCommands and createRegisterCommands", async () => {
        const mod = await importFreshDiscordClient();

        assert.ok(mod.client);
        assert.equal(mod.DISCORD_TOKEN, "mock-token");
        assert.equal(typeof mod.registerCommands, "function");
        assert.equal(typeof mod.createRegisterCommands, "function");
    });

    test("client should have intents configured", async () => {
        const mod = await importFreshDiscordClient();
        assert.ok(mod.client.options.intents);
    });
});

describe("createRegisterCommands", () => {
    test("should register guild commands when DISCORD_GUILD_ID is numeric", async () => {
        const { createRegisterCommands } = await importFreshDiscordClient({ guildId: "1234567890" });
        const calls = [];

        const registerCommands = createRegisterCommands({
            client: {
                application: {
                    fetch: async () => ({ id: "app-1" })
                }
            },
            guildId: "1234567890",
            restClient: {
                put: async (route, payload) => {
                    calls.push({ route, payload });
                }
            },
            routes: {
                applicationGuildCommands: (appId, guildId) => `guild:${appId}:${guildId}`,
                applicationCommands: (appId) => `global:${appId}`
            }
        });

        await registerCommands();

        assert.equal(calls.length, 1);
        assert.equal(calls[0].route, "guild:app-1:1234567890");
        assert.ok(Array.isArray(calls[0].payload.body));
        assert.equal(calls[0].payload.body[0].name, "o");
    });

    test("should register global commands when guild ID is absent", async () => {
        const { createRegisterCommands } = await importFreshDiscordClient();
        const calls = [];

        const registerCommands = createRegisterCommands({
            client: {
                application: {
                    fetch: async () => ({ id: "app-2" })
                }
            },
            guildId: "",
            restClient: {
                put: async (route, payload) => {
                    calls.push({ route, payload });
                }
            },
            routes: {
                applicationGuildCommands: (appId, guildId) => `guild:${appId}:${guildId}`,
                applicationCommands: (appId) => `global:${appId}`
            }
        });

        await registerCommands();

        assert.equal(calls.length, 1);
        assert.equal(calls[0].route, "global:app-2");
        assert.ok(Array.isArray(calls[0].payload.body));
    });

    test("should fall back to global registration when guild ID is invalid", async () => {
        const { createRegisterCommands } = await importFreshDiscordClient({ guildId: "not-a-number" });
        const calls = [];

        const registerCommands = createRegisterCommands({
            client: {
                application: {
                    fetch: async () => ({ id: "app-3" })
                }
            },
            guildId: "not-a-number",
            restClient: {
                put: async (route, payload) => {
                    calls.push({ route, payload });
                }
            },
            routes: {
                applicationGuildCommands: (appId, guildId) => `guild:${appId}:${guildId}`,
                applicationCommands: (appId) => `global:${appId}`
            }
        });

        await registerCommands();

        assert.equal(calls.length, 1);
        assert.equal(calls[0].route, "global:app-3");
    });

    test("should log an error when the Discord application is not ready", async () => {
        const { createRegisterCommands } = await importFreshDiscordClient();
        const originalConsoleError = console.error;
        const logged = [];
        let putCalled = false;

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
        assert.equal(logged[0][0], "Failed to register commands");
        assert.match(String(logged[0][1]?.message), /Discord application is not ready/);
    });
});

describe("discordClient without token", () => {
    test("should attempt to exit when DISCORD_TOKEN is empty", async () => {
        const originalExit = process.exit;
        let exitCalled = false;

        process.exit = (code) => {
            exitCalled = true;
            throw new Error(`process.exit(${code}) called`);
        };

        try {
            await importFreshDiscordClient({ token: "" });
        } catch {
            // process.exit is mocked to throw in this test.
        } finally {
            process.exit = originalExit;
        }

        assert.equal(exitCalled, true);
    });
});
