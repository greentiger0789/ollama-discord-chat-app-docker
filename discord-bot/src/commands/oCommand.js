import {
    composePromptWithAttachment,
    createAttachmentHistoryText,
    loadAttachmentText
} from '../attachmentLoader.js';
import { createLogger } from '../logger.js';
import { buildMaidThinkingMessage, sendSplitMessage } from '../messageUtils.js';
import { generateResponse } from '../ollamaClient.js';
import { resolveSpeakerName } from '../speakerUtils.js';
import { addToThreadHistory, getThreadHistory, initializeThread } from '../threadManager.js';
import { generateThreadName } from '../threadNaming.js';

const logger = createLogger('oCommand');

// デフォルトの依存関係
const defaultDeps = {
    buildMaidThinkingMessage,
    sendSplitMessage,
    generateResponse,
    getThreadHistory,
    addToThreadHistory,
    initializeThread,
    generateThreadName,
    resolveSpeakerName,
    loadAttachmentText,
    composePromptWithAttachment,
    createAttachmentHistoryText
};

export function createHandleOCommand(deps = defaultDeps) {
    const {
        buildMaidThinkingMessage: buildThinking,
        sendSplitMessage,
        generateResponse,
        getThreadHistory,
        addToThreadHistory,
        initializeThread,
        generateThreadName: nameThread,
        resolveSpeakerName,
        loadAttachmentText,
        composePromptWithAttachment,
        createAttachmentHistoryText
    } = { ...defaultDeps, ...deps };

    return async function handleOCommand(interaction) {
        const prompt = interaction.options.getString('prompt');
        const attachment = interaction.options.getAttachment?.('file') || null;
        logger.info('Received /o command', {
            userId: interaction.user?.id || null,
            promptLength: prompt?.length || 0,
            hasAttachment: Boolean(attachment)
        });

        await interaction.deferReply();

        try {
            let responsePrompt = prompt;
            let historyPrompt = prompt;
            let attachmentName = null;
            if (attachment) {
                const result = await loadAttachmentText(attachment);
                if (!result.ok) {
                    await interaction.followUp({ content: result.message, ephemeral: true });
                    return;
                }

                responsePrompt = composePromptWithAttachment(prompt, result);
                historyPrompt = createAttachmentHistoryText(prompt, result);
                attachmentName = result.name;
            }

            const replyMsg = await interaction.followUp({
                content: 'スレッドを作成しました'
            });

            const thread = await replyMsg.startThread({
                name: nameThread(prompt, interaction.user.username),
                autoArchiveDuration: 60
            });
            logger.info('Created response thread for /o command', {
                threadId: thread.id,
                userId: interaction.user?.id || null
            });

            initializeThread(thread.id);
            const history = getThreadHistory(thread.id);
            const speaker = resolveSpeakerName(interaction);
            addToThreadHistory(thread.id, { role: 'user', text: historyPrompt, speaker });

            const threadIntro = [
                `**プロンプト:** ${prompt}`,
                attachmentName && `📎 添付: ${attachmentName}`
            ]
                .filter(Boolean)
                .join('\n');
            await thread.send({ content: threadIntro, allowedMentions: { parse: [] } });

            const thinkingMsg = await thread.send(buildThinking());

            const responseText = await generateResponse(responsePrompt, history, { speaker });

            addToThreadHistory(thread.id, { role: 'assistant', text: responseText });

            await sendSplitMessage(thread, responseText, thinkingMsg);
            logger.info('Completed /o command response', {
                threadId: thread.id,
                responseLength: responseText.length
            });
        } catch (err) {
            logger.error('Error handling /o command', err, {
                userId: interaction.user?.id || null
            });
            await interaction
                .followUp({
                    content: 'エラーが発生しました。',
                    ephemeral: true
                })
                .catch(() => {});
        }
    };
}

// デフォルトのエクスポート（後方互換性）
export const handleOCommand = createHandleOCommand();
