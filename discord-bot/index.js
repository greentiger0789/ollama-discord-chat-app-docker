// loadEnv は他モジュールのトップレベル process.env 読み取り（OLLAMA_MODEL 等）より
// 先に実行される必要があるため、biome の organizeImports 対象外とする
import './src/loadEnv.js';
import { handleOCommand } from './src/commands/oCommand.js';
import { handleOResetCommand } from './src/commands/resetCommand.js';
import { handleOSummaryCommand } from './src/commands/summaryCommand.js';
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

    switch (interaction.commandName) {
        case 'o':
            await handleOCommand(interaction);
            break;
        case 'o-reset':
            await handleOResetCommand(interaction);
            break;
        case 'o-summary':
            await handleOSummaryCommand(interaction);
            break;
    }
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
