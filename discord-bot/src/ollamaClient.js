import { tavily } from '@tavily/core';
import axios from 'axios';
import { decisionPrompt } from './decisionPrompt.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';

const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });

export default function createOllamaClient({ baseURL = 'http://ollama:11434' } = {}) {

    const client = axios.create({
        baseURL,
        timeout: 300000 // 推論モデル考慮（5分）
    });

    async function generate({ model = 'qwen3.5:9b', prompt = '', history = [] } = {}) {

        /* =========================================
           ① トークン概算（かなり安全寄り）
        ========================================= */

        function estimateTokensFromText(text) {
            if (!text) return 0;
            return Math.ceil(text.length / 3); // 日本語LLM向けの緩い概算
        }

        function estimateTokensFromHistory(hist) {
            return hist.reduce((sum, m) => {
                return sum + estimateTokensFromText(m.text);
            }, 0);
        }

        const MAX_CONTEXT_TOKENS = 12000;   // num_ctx 16384を考慮
        const SAFETY_MARGIN = 2000;         // 推論thinking余白
        const LIMIT = MAX_CONTEXT_TOKENS - SAFETY_MARGIN;

        let processedHistory = [...history];

        /* =========================================
           ② 履歴が閾値を超えたら要約
        ========================================= */

        const historyTokens = estimateTokensFromHistory(history);
        const promptTokens = estimateTokensFromText(prompt);

        if (historyTokens + promptTokens > LIMIT && history.length > 1) {

            // 🔥 最新userは除外
            const oldHistory = history.slice(0, -1);

            const summary = await summarizeHistory(client, model, oldHistory);

            processedHistory = [
                {
                    role: "assistant",
                    text: `【過去の会話要約】\n${summary}`
                },
                history[history.length - 1]
            ];
        }

        /* =========================================
           ③ 検索判定
        ========================================= */

        const plan = await decideSearchPlan(client, model, prompt);

        let searchResults = '';
        if (plan.needSearch) {
            searchResults = await executeSearch(plan);
        }

        /* =========================================
           ④ 最終メッセージ構築
        ========================================= */

        const finalMessages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...processedHistory.map(m => ({
                role: m.role === 'user' ? 'user' : 'assistant',
                content: m.text
            })),
            {
                role: 'user',
                content: plan.needSearch && searchResults
                    ? buildAugmentedPrompt(prompt, searchResults)
                    : prompt
            }
        ];

        /* =========================================
           ⑤ 本推論
        ========================================= */

        try {
            const res = await client.post('/api/chat', {
                model,
                messages: finalMessages,
                stream: false,
                options: {
                    num_ctx: 16384,
                    num_predict: 8192,
                    temperature: 0.3
                }
            });

            const content = extractAssistantMessage(res.data);

            if (content !== null) return content;

            console.error("Unknown response format:", res.data);
            return "回答形式を解析できませんでした。";

        } catch (err) {
            if (err.response?.data) {
                try { return await streamToString(err.response.data); } catch { }
            }
            throw err;
        }
    }

    return { generate };
}

/* ===================================================== */

async function decideSearchPlan(client, model, prompt) {

    const forceKeywords = [
        "今日", "明日", "現在", "最新",
        "天気", "価格", "株価", "ニュース",
        "為替", "リアルタイム"
    ];

    const hasForceKeyword = forceKeywords.some(k => prompt.includes(k));

    try {
        const res = await client.post('/api/chat', {
            model,
            messages: [
                { role: 'system', content: decisionPrompt },
                { role: 'user', content: `質問: ${prompt}` }
            ],
            format: 'json',
            stream: false,
            options: {
                temperature: 0,
                num_predict: 200
            }
        });

        const raw =
            res.data?.message?.content ||
            res.data?.choices?.[0]?.message?.content ||
            "{}";

        const parsed = safeJsonParse(raw);

        return {
            needSearch: hasForceKeyword || !!parsed.needSearch,
            engine: parsed.engine === "ddg" ? "ddg" : "tavily",
            searchQuery: parsed.searchQuery || prompt
        };

    } catch {
        return {
            needSearch: hasForceKeyword,
            engine: "tavily",
            searchQuery: prompt
        };
    }
}

/* ===================================================== */
/* 🌐 検索 */
/* ===================================================== */

async function executeSearch(plan) {
    if (!plan.searchQuery) return "検索クエリが無効です。";
    if (plan.engine === "ddg") return await searchDuckDuckGo(plan.searchQuery);
    return await searchTavily(plan.searchQuery);
}

async function searchTavily(query) {
    try {
        const response = await tvly.search(query, {
            searchDepth: "advanced",
            maxResults: 5,
            includeAnswer: false
        });

        if (!response?.results?.length)
            return "検索結果が見つかりませんでした。";

        const formatted = response.results.map(r =>
            `タイトル: ${r.title}
内容: ${truncate(r.content, 500)}
URL: ${r.url}`
        ).join("\n\n");

        return truncate(formatted, 4000);

    } catch (err) {
        console.error("Tavily Error:", err.message);
        return "Tavily検索に失敗しました。";
    }
}

async function searchDuckDuckGo(query) {
    try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const res = await axios.get(url);

        const topics = res.data.RelatedTopics || [];
        const flattened = topics.flatMap(t => t.Topics || t);

        const results = flattened
            .filter(t => t.Text)
            .slice(0, 5)
            .map(t => t.Text)
            .join("\n");

        return results || "検索結果が見つかりませんでした。";

    } catch (err) {
        console.error("DDG Error:", err.message);
        return "DuckDuckGo検索に失敗しました。";
    }
}

/* ===================================================== */
/* 🧠 検索統合プロンプト */
/* ===================================================== */

function buildAugmentedPrompt(originalPrompt, searchResults) {
    return `
以下はWeb検索結果です。

${searchResults}

上記を参考に、正確かつ具体的に回答してください。

質問:
${originalPrompt}
`;
}

/* ===================================================== */
/* 🧠 JSON安全パース（推論汚染耐性） */
/* ===================================================== */

function safeJsonParse(rawText) {
    if (!rawText) return {};

    try {
        // ① <think>削除
        let clean = rawText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        // ② ```json ブロック除去
        clean = clean.replace(/```json|```/g, '');

        // ③ 最初と最後の{}抽出
        const first = clean.indexOf('{');
        const last = clean.lastIndexOf('}');
        if (first !== -1 && last !== -1) {
            clean = clean.slice(first, last + 1);
        }

        return JSON.parse(clean);
    } catch {
        return {};
    }
}

/* ===================================================== */
/* 🤖 レスポンス統合抽出 */
/* ===================================================== */

function extractAssistantMessage(data) {
    if (!data) return null;

    // ① Ollama標準
    if (data.message) {
        const { content } = data.message;

        if (typeof content === "string") {
            const cleaned = stripThinkTags(content).trim();
            if (cleaned.length > 0) {
                return cleaned;
            }
        }

        return null;
    }

    // ② OpenAI互換
    if (data.choices?.length) {
        const msg = data.choices[0]?.message;
        if (typeof msg?.content === "string") {
            const cleaned = stripThinkTags(msg.content).trim();
            if (cleaned.length > 0) {
                return cleaned;
            }
        }
        return null;
    }

    // ③ generate互換
    if (typeof data.response === "string") {
        const cleaned = stripThinkTags(data.response).trim();
        if (cleaned.length > 0) {
            return cleaned;
        }
    }

    return null;
}

/* ===================================================== */

function stripThinkTags(text) {
    if (!text) return text;
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function truncate(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength
        ? text.slice(0, maxLength) + "..."
        : text;
}

async function streamToString(stream) {
    if (typeof stream === 'string') return stream;
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(typeof chunk === 'string'
            ? chunk
            : chunk.toString('utf8'));
    }
    return chunks.join('');
}

async function summarizeHistory(client, model, history) {
    if (!history?.length) return null;

    const messages = [
        {
            role: "system",
            content: "以下の会話履歴を簡潔に要約してください。重要な事実・前提・未解決事項を保持してください。"
        },
        {
            role: "user",
            content: history.map(m => `${m.role}: ${m.text}`).join("\n")
        }
    ];

    const res = await client.post('/api/chat', {
        model,
        messages,
        stream: false,
        options: {
            temperature: 0,
            num_predict: 512
        }
    });

    return extractAssistantMessage(res.data);
}
