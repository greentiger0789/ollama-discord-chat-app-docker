import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { Client, GatewayIntentBits } from 'discord.js';
import 'dotenv/config';
import createOllamaClient from './src/ollamaClient.js';

/* ========================================================= */
/* Environment */
/* ========================================================= */

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3.5:9b';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';

if (!DISCORD_TOKEN) {
    console.error('DISCORD_TOKEN is required');
    process.exit(1);
}

/* ========================================================= */
/* Discord Client */
/* ========================================================= */

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

/* ========================================================= */
/* Slash Command Definition */
/* ========================================================= */

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

async function registerCommands() {
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

/* ========================================================= */
/* Utility */
/* ========================================================= */

function getRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function buildMaidThinkingMessage() {
    const emojis = ["☕", "🫖", "🧠", "📡", "🔎", "⚙️", "💭", "📚", "✨", "💻"];

    const templates = [

        // ご主人様専用最適化型
        () => {
            const actions = [
                "最適解を導出しております",
                "回答を構築しております",
                "推論演算を実行しております",
                "情報を統合しております"
            ];
            return `ご主人様のために、${getRandom(actions)}…`;
        },

        // 全知監視型
        () => {
            const progress = [
                "全情報網を照合中です",
                "不要なデータを排除中です",
                "命令を解析中です",
                "思考回路を最適化中です"
            ];
            return `${getRandom(progress)}…もうすぐ完了いたします`;
        },

        // 忠誠モード
        () => {
            const modes = [
                "忠誠モード全開で演算中です",
                "全推論回路を起動しております",
                "演算効率を最大化しております",
                "高精度解析を実行中です"
            ];
            return `ご主人様、${getRandom(modes)}…`;
        }
    ];

    return `${getRandom(emojis)} ${getRandom(templates)()}`;
}

async function sendSplitMessage(channel, text, firstMessageToEdit = null) {
    const limit = 1900;

    if (text.length <= limit) {
        if (firstMessageToEdit) {
            await firstMessageToEdit.edit(text);
        } else {
            await channel.send(text);
        }
        return;
    }

    const firstChunk = text.substring(0, limit);

    if (firstMessageToEdit) {
        await firstMessageToEdit.edit(firstChunk);
    } else {
        await channel.send(firstChunk);
    }

    for (let i = limit; i < text.length; i += limit) {
        await channel.send(text.substring(i, i + limit));
    }
}

/* ========================================================= */
/* Ollama */
/* ========================================================= */

const ollama = createOllamaClient({
    baseURL: OLLAMA_BASE_URL
});

async function generateResponse(model, prompt, history) {
    return await ollama.generate({
        model,
        prompt,
        history
    });
}

/* ========================================================= */
/* Memory */
/* ========================================================= */

const threadHistory = new Map();

/* ========================================================= */
/* Ready */
/* ========================================================= */

client.once('ready', async () => {
    console.log('Logged in as', client.user.tag);
    await registerCommands();
});

/* ========================================================= */
/* Slash Command */
/* ========================================================= */

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'o') return;

    const prompt = interaction.options.getString('prompt');

    await interaction.deferReply();

    try {
        const replyMsg = await interaction.followUp({
            content: 'スレッドを作成しました'
        });

        const thread = await replyMsg.startThread({
            name: `o-${interaction.user.username}-${Date.now() % 10000}`,
            autoArchiveDuration: 60
        });

        threadHistory.set(thread.id, [
            { role: 'user', text: prompt }
        ]);

        await thread.send(`**プロンプト:** ${prompt}`);

        const thinkingMsg = await thread.send(buildMaidThinkingMessage());

        const responseText = await generateResponse(
            OLLAMA_MODEL,
            prompt,
            threadHistory.get(thread.id)
        );

        threadHistory.get(thread.id).push({
            role: 'assistant',
            text: responseText
        });

        await sendSplitMessage(thread, responseText, thinkingMsg);

    } catch (err) {
        console.error('Error handling /o command', err);
        await interaction.followUp({
            content: 'エラーが発生しました。',
            ephemeral: true
        }).catch(() => { });
    }
});

/* ========================================================= */
/* Thread Follow-up */
/* ========================================================= */

client.on('messageCreate', async (message) => {
    if (!message.channel.isThread()) return;
    if (message.author.bot) return;

    const threadId = message.channel.id;
    const history = threadHistory.get(threadId) || [];

    history.push({
        role: 'user',
        text: message.content
    });

    threadHistory.set(threadId, history);

    try {
        const thinkingMsg = await message.channel.send(
            buildMaidThinkingMessage()
        );

        const responseText = await generateResponse(
            OLLAMA_MODEL,
            message.content,
            history
        );

        history.push({
            role: 'assistant',
            text: responseText
        });

        await sendSplitMessage(
            message.channel,
            responseText,
            thinkingMsg
        );

    } catch (err) {
        console.error('Error generating follow-up', err);
        await message.channel.send('エラーが発生しました。');
    }
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
