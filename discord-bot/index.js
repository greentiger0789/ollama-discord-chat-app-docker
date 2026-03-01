import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { Client, GatewayIntentBits } from 'discord.js';
import 'dotenv/config';
import createOllamaClient from './src/ollamaClient.js';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!DISCORD_TOKEN) {
    console.error('DISCORD_TOKEN is required');
    process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

const commands = [
    {
        name: 'o',
        description: 'Send prompt to Ollama',
        options: [
            { name: 'prompt', description: 'Prompt to send', type: 3, required: true },
            // { name: 'model', description: 'Ollama model to use (optional)', type: 3, required: false }
        ]
    }
];

async function registerCommands() {
    try {
        const appId = (await client.application?.fetch()).id;
        if (GUILD_ID && /^[0-9]+$/.test(GUILD_ID)) {
            await rest.put(Routes.applicationGuildCommands(appId, GUILD_ID), { body: commands });
            console.log('Registered commands to guild', GUILD_ID);
        } else {
            await rest.put(Routes.applicationCommands(appId), { body: commands });
            console.log('Registered global commands');
        }
    } catch (err) {
        console.error('Failed to register commands', err);
    }
}

async function sendSplitMessage(channel, text) {
    const limit = 1900;
    for (let i = 0; i < text.length; i += limit) {
        await channel.send(text.substring(i, i + limit));
    }
}

const ollama = createOllamaClient({ baseURL: process.env.OLLAMA_BASE_URL || 'http://ollama:11434' });
const threadHistory = new Map();

client.once('ready', async () => {
    console.log('Logged in as', client.user.tag);
    await registerCommands();
});

async function generateResponse(model, prompt, history) {
    // /api/chat に合わせてhistoryを渡す
    return await ollama.generate({ model, prompt, history });
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'o') return;

    const prompt = interaction.options.getString('prompt');
    // const model = interaction.options.getString('model') || process.env.OLLAMA_MODEL || 'qwen3:14b';
    const model = process.env.OLLAMA_MODEL || 'qwen3:14b';

    await interaction.deferReply();

    try {
        const replyMsg = await interaction.followUp({ content: '考え中…' });
        const thread = await replyMsg.startThread({ name: `o-${interaction.user.username}-${Date.now() % 10000}`, autoArchiveDuration: 60 });

        threadHistory.set(thread.id, [{ role: 'user', text: prompt }]);
        await thread.send(`**プロンプト:** ${prompt}`);

        const responseText = await generateResponse(model, prompt, threadHistory.get(thread.id));
        threadHistory.get(thread.id).push({ role: 'assistant', text: responseText });

        await sendSplitMessage(thread, responseText);
    } catch (err) {
        console.error('Error handling /o command', err);
        await interaction.followUp({ content: 'エラーが発生しました。', ephemeral: true }).catch(() => { });
    }
});

client.on('messageCreate', async (message) => {
    if (!message.channel.isThread() || message.author.bot) return;

    const threadId = message.channel.id;
    const history = threadHistory.get(threadId) || [];
    history.push({ role: 'user', text: message.content });
    threadHistory.set(threadId, history);

    try {
        const model = process.env.OLLAMA_MODEL || 'qwen3:14b';
        const responseText = await generateResponse(model, message.content, history);
        history.push({ role: 'assistant', text: responseText });
        await sendSplitMessage(message.channel, responseText);
    } catch (err) {
        console.error('Error generating follow-up', err);
        await message.channel.send('エラーが発生しました。');
    }
});

process.on('SIGTERM', () => {
    console.log('Shutting down');
    client.destroy();
    process.exit(0);
});

client.login(DISCORD_TOKEN).catch((e) => {
    console.error('Login failed', e);
    process.exit(1);
});
