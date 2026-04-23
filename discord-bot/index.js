import './src/loadEnv.js';
import { handleOCommand } from './src/commands/oCommand.js';
import { client, DISCORD_TOKEN, registerCommands } from './src/discordClient.js';
import { handleThreadMessage } from './src/handlers/threadMessageHandler.js';
import { createLogger } from './src/logger.js';

const logger = createLogger('index');

/* ========================================================= */
/* Ready */
/* ========================================================= */

client.once('clientReady', async () => {
    logger.info('Discord client is ready', {
        userTag: client.user.tag
    });
    await registerCommands();
});

/* ========================================================= */
/* Slash Command */
/* ========================================================= */

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'o') return;

    await handleOCommand(interaction);
});

/* ========================================================= */
/* Thread Follow-up */
/* ========================================================= */

client.on('messageCreate', async message => {
    await handleThreadMessage(message);
});

/* ========================================================= */
/* Shutdown */
/* ========================================================= */

process.on('SIGTERM', () => {
    logger.info('Received SIGTERM. Shutting down Discord client.');
    client.destroy();
    process.exit(0);
});

client.login(DISCORD_TOKEN).catch(e => {
    logger.error('Login failed', e);
    process.exit(1);
});
