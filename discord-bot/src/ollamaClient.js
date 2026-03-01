import axios from 'axios';
import { SYSTEM_PROMPT } from './systemPrompt.js';

export default function createOllamaClient({ baseURL = 'http://ollama:11434' } = {}) {
    const client = axios.create({ baseURL, timeout: 180000 });

    async function generate({ model = 'qwen3:14b', prompt = '', history = [] } = {}) {
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...history.map(m => ({
                role: m.role === 'user' ? 'user' : 'assistant',
                content: m.text
            })),
            { role: 'user', content: prompt }
        ];

        try {
            const res = await client.post('/api/chat', {
                model,
                messages,
                stream: false, // ← thinking を含まない最終回答のみ
                options: {
                    num_ctx: 8192,
                    num_predict: 3000,
                    temperature: 0.3,
                    stop: ["User:"]
                }
            });

            // アシスタントの発言のみ取り出す
            let assistantText = '';
            if (res.data?.message?.content) {
                assistantText = res.data.message.content;
            } else if (res.data?.choices?.[0]?.message?.content) {
                assistantText = res.data.choices[0].message.content;
            } else {
                assistantText = JSON.stringify(res.data);
            }

            return assistantText;

        } catch (err) {
            if (err.response?.data) {
                try {
                    const txt = await streamToString(err.response.data);
                    return txt;
                } catch { }
            }
            throw err;
        }
    }

    return { generate };
}

async function streamToString(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    }
    return chunks.join('');
}
