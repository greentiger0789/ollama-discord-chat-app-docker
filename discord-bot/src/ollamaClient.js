import { tavily } from '@tavily/core';
import axios from 'axios';
import { decisionPrompt } from './decisionPrompt.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';

const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });

export default function createOllamaClient({ baseURL = 'http://ollama:11434' } = {}) {
    const client = axios.create({
        baseURL,
        timeout: 180000
    });

    async function generate({ model = 'qwen3:14b', prompt = '', history = [] } = {}) {

        // =============================
        // 1️⃣ 検索戦略決定
        // =============================
        const plan = await decideSearchPlan(client, model, prompt);

        let searchResults = '';

        if (plan.needSearch) {
            searchResults = await executeSearch(plan);
        }

        // =============================
        // 2️⃣ 最終プロンプト構築
        // =============================
        const finalMessages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...history.map(m => ({
                role: m.role === 'user' ? 'user' : 'assistant',
                content: m.text
            })),
            {
                role: 'user',
                content: plan.needSearch
                    ? buildAugmentedPrompt(prompt, searchResults)
                    : prompt
            }
        ];

        // =============================
        // 3️⃣ 最終回答生成
        // =============================
        try {
            const res = await client.post('/api/chat', {
                model,
                messages: finalMessages,
                stream: false,
                options: {
                    num_ctx: 16384,
                    num_predict: 3000,
                    temperature: 0.3
                }
            });

            return (
                res.data?.message?.content ||
                res.data?.choices?.[0]?.message?.content ||
                "回答を取得できませんでした。"
            );

        } catch (err) {
            if (err.response?.data) {
                try { return await streamToString(err.response.data); } catch { }
            }
            throw err;
        }
    }

    return { generate };
}

/* =====================================================
   🔎 検索戦略決定
===================================================== */
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

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            parsed = {};
        }

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

/* =====================================================
   🌐 エンジン実行
===================================================== */
async function executeSearch(plan) {

    if (!plan.searchQuery) return "検索クエリが無効です。";

    if (plan.engine === "ddg") {
        return await searchDuckDuckGo(plan.searchQuery);
    }

    return await searchTavily(plan.searchQuery);
}

/* =====================================================
   🔵 Tavily（高度検索）
===================================================== */
async function searchTavily(query) {
    try {
        const response = await tvly.search(query, {
            searchDepth: "advanced",
            maxResults: 5,
            includeAnswer: false
        });

        if (!response?.results?.length)
            return "検索結果が見つかりませんでした。";

        const formatted = response.results.map((r) => {
            return `タイトル: ${r.title}
        内容: ${truncate(r.content, 500)}
        URL: ${r.url}`;
        }).join("\n\n");

        return truncate(formatted, 4000);

    } catch (err) {
        console.error("Tavily Error:", err.message);
        return "Tavily検索に失敗しました。";
    }
}

/* =====================================================
   🟢 DuckDuckGo（軽量検索）
===================================================== */
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

/* =====================================================
   🧠 検索統合プロンプト
===================================================== */
function buildAugmentedPrompt(originalPrompt, searchResults) {
    return `
以下はWeb検索結果です。

${searchResults}

上記を参考に、正確かつ具体的に回答してください。

質問:
${originalPrompt}
`;
}

/* =====================================================
   🔧 ユーティリティ
===================================================== */
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
