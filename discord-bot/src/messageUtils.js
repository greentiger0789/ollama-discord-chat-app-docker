function getRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

export function buildMaidThinkingMessage() {
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

export async function sendSplitMessage(channel, text, firstMessageToEdit = null) {
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
