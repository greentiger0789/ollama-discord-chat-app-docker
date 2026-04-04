import 'dotenv/config';
import { handleOCommand } from './src/commands/oCommand.js';
import { client, DISCORD_TOKEN, registerCommands } from './src/discordClient.js';
import { handleThreadMessage } from './src/handlers/threadMessageHandler.js';

/* ========================================================= */
/* Ready */
/* ========================================================= */

client.once('clientReady', async () => {
    console.log('Logged in as', client.user.tag);
    await registerCommands();
});

/* ========================================================= */
/* Slash Command */
/* ========================================================= */

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'o') return;

    await handleOCommand(interaction);
});

/* ========================================================= */
/* Thread Follow-up */
/* ========================================================= */

client.on('messageCreate', async (message) => {
    await handleThreadMessage(message);
});

/* ========================================================= */
/* Shutdown */
/* ========================================================= */

process.on('SIGTERM', () => {
    console.log('Shutting down');
    client.destroy();
    process.exit(0);
});

client.login(DISCORD_TOKEN).catch((e) => {
    console.error('Login failed', e);
    process.exit(1);
});
