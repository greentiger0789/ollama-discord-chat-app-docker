import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tavily } from '@tavily/core';
import yaml from 'js-yaml';
import fetch from 'node-fetch';
import { decisionPrompt } from './decisionPrompt.js';
import { createLogger } from './logger.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MODEL_CONFIG_CANDIDATES = [
    path.resolve(MODULE_DIR, '../config/models.yml'),
    path.resolve(MODULE_DIR, '../config/models.yaml')
];
const DEFAULT_REQUEST_TIMEOUT_MS = 300000;
const THINKING_RETRY_MIN_BUMP = 2048;
const THINKING_RETRY_MAX_NUM_PREDICT = 16384;
const SEARCH_NO_RESULTS_MESSAGE = '検索結果が見つかりませんでした。';
const TAVILY_SEARCH_FAILED_MESSAGE = 'Tavily検索に失敗しました。';
const DDG_SEARCH_FAILED_MESSAGE = 'DuckDuckGo検索に失敗しました。';
const SEARCH_STATUS_SUCCESS = 'success';
const SEARCH_STATUS_NO_RESULTS = 'no_results';
const SEARCH_STATUS_ERROR = 'error';
const logger = createLogger('ollamaClient');
let MODEL_CONFIG = {};

try {
    const MODEL_CONFIG_PATH = MODEL_CONFIG_CANDIDATES.find(candidate => fs.existsSync(candidate));
    if (!MODEL_CONFIG_PATH) {
        throw new Error(`No config found in: ${MODEL_CONFIG_CANDIDATES.join(', ')}`);
    }
    const file = fs.readFileSync(MODEL_CONFIG_PATH, 'utf8');
    MODEL_CONFIG = yaml.load(file)?.models || {};
    logger.info('Loaded model config', {
        path: MODEL_CONFIG_PATH,
        modelCount: Object.keys(MODEL_CONFIG).length
    });
} catch (err) {
    logger.warn('Model config load failed. Using defaults.', err, {
        candidates: MODEL_CONFIG_CANDIDATES
    });
}

function createTavilyClient(apiKey = process.env.TAVILY_API_KEY) {
    if (!apiKey) {
        return null;
    }

    return tavily({ apiKey });
}

// デフォルトの検索関数
const defaultSearchFn = async plan =>
    executeSearchWithDeps(plan, createTavilyClient(), createHttpClient());

export default function createOllamaClient({
    baseURL = 'http://ollama:11434',
    searchFn = defaultSearchFn,
    httpClient = createHttpClient({ baseURL, timeout: DEFAULT_REQUEST_TIMEOUT_MS })
} = {}) {
    const client = httpClient;

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

        const MAX_CONTEXT_TOKENS = 12000; // num_ctx 16384を考慮
        const SAFETY_MARGIN = 2000; // 推論thinking余白
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
            logger.info('Summarizing conversation history', {
                model,
                historyCount: history.length,
                estimatedTokens: historyTokens + promptTokens,
                limit: LIMIT
            });

            const summary = await summarizeHistory(client, model, oldHistory);

            processedHistory = [
                {
                    role: 'assistant',
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
            searchResults = await searchFn(plan);
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
                content:
                    plan.needSearch && searchResults
                        ? buildAugmentedPrompt(prompt, searchResults)
                        : prompt
            }
        ];

        /* =========================================
           ⑤ 本推論
        ========================================= */

        try {
            const modelOptions = getModelOptions(model);
            const { content, data } = await requestAssistantContentWithRetry(client, {
                model,
                messages: finalMessages,
                stream: false,
                options: modelOptions
            });

            if (content !== null) return content;

            if (hasThinkingOnlyResponse(data)) {
                logger.warn('Assistant response exhausted in thinking mode', {
                    response: summarizeResponseShape(data)
                });
                return '回答本文を取得できませんでした。';
            }

            logger.error('Unknown assistant response format', {
                response: summarizeResponseShape(data)
            });
            return '回答形式を解析できませんでした。';
        } catch (err) {
            if (err.response?.data) {
                try {
                    return await streamToString(err.response.data);
                } catch {}
            }
            throw err;
        }
    }

    return { generate };
}

/* ===================================================== */

async function decideSearchPlan(client, model, prompt) {
    const forceKeywords = [
        '今日',
        '明日',
        '現在',
        '最新',
        '天気',
        '価格',
        '株価',
        'ニュース',
        '為替',
        'リアルタイム'
    ];

    const hasForceKeyword = forceKeywords.some(k => prompt.includes(k));

    try {
        const res = await postChat(
            client,
            {
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
            },
            { think: false }
        );

        const raw = res.data?.message?.content || res.data?.choices?.[0]?.message?.content || '{}';

        const parsed = safeJsonParse(raw);
        const plan = {
            needSearch: hasForceKeyword || !!parsed.needSearch,
            engine: parsed.engine === 'ddg' ? 'ddg' : 'tavily',
            searchQuery: parsed.searchQuery || prompt
        };
        logger.info('Search plan decided', {
            model,
            needSearch: plan.needSearch,
            engine: plan.engine,
            forcedByKeyword: hasForceKeyword,
            query: summarizeQuery(plan.searchQuery)
        });
        return plan;
    } catch (err) {
        const fallbackPlan = {
            needSearch: hasForceKeyword,
            engine: 'tavily',
            searchQuery: prompt
        };
        logger.warn('Search plan generation failed. Using fallback plan.', err, {
            model,
            needSearch: fallbackPlan.needSearch,
            engine: fallbackPlan.engine,
            forcedByKeyword: hasForceKeyword,
            query: summarizeQuery(fallbackPlan.searchQuery)
        });
        return fallbackPlan;
    }
}

/* ===================================================== */
/* 🌐 検索（依存関係注入版）
/* ===================================================== */

export async function executeSearchWithDeps(plan, tavilyClient, httpClient) {
    if (!plan.searchQuery) {
        logger.warn('Search skipped because the query is invalid', {
            engine: plan.engine || 'unknown'
        });
        return '検索クエリが無効です。';
    }
    if (plan.engine === 'ddg') {
        logger.info('Using DuckDuckGo for web search', {
            query: summarizeQuery(plan.searchQuery)
        });
        return await searchDuckDuckGoWithDeps(plan.searchQuery, httpClient);
    }

    logger.info('Using Tavily for web search', {
        query: summarizeQuery(plan.searchQuery)
    });

    const tavilyResult = await executeTavilySearch(plan.searchQuery, tavilyClient);
    if (tavilyResult.status !== SEARCH_STATUS_ERROR || tavilyResult.reason === 'unconfigured') {
        return tavilyResult.message;
    }

    logger.warn('Tavily search failed. Falling back to DuckDuckGo.', {
        query: summarizeQuery(plan.searchQuery)
    });
    const ddgResult = await executeDuckDuckGoSearch(plan.searchQuery, httpClient);

    if (ddgResult.status === SEARCH_STATUS_SUCCESS) {
        logger.info('DuckDuckGo fallback succeeded', {
            query: summarizeQuery(plan.searchQuery)
        });
    } else {
        logger.warn('DuckDuckGo fallback did not recover Tavily failure', {
            query: summarizeQuery(plan.searchQuery),
            status: ddgResult.status
        });
    }

    return ddgResult.status === SEARCH_STATUS_SUCCESS ? ddgResult.message : tavilyResult.message;
}

export async function searchTavilyWithDeps(query, tavilyClient) {
    const result = await executeTavilySearch(query, tavilyClient);
    return result.message;
}

async function executeTavilySearch(query, tavilyClient) {
    try {
        if (!tavilyClient?.search) {
            logger.warn('Tavily search skipped because TAVILY_API_KEY is not configured.', {
                query: summarizeQuery(query)
            });
            return {
                status: SEARCH_STATUS_ERROR,
                reason: 'unconfigured',
                message: TAVILY_SEARCH_FAILED_MESSAGE
            };
        }

        logger.info('Calling Tavily search', {
            query: summarizeQuery(query)
        });
        const response = await tavilyClient.search(query, {
            searchDepth: 'advanced',
            maxResults: 5,
            includeAnswer: false
        });

        if (!response?.results?.length) {
            logger.info('Tavily search returned no results', {
                query: summarizeQuery(query)
            });
            return {
                status: SEARCH_STATUS_NO_RESULTS,
                message: SEARCH_NO_RESULTS_MESSAGE
            };
        }

        const formatted = response.results
            .map(
                r =>
                    `タイトル: ${r.title}
内容: ${truncate(r.content, 500)}
URL: ${r.url}`
            )
            .join('\n\n');

        logger.info('Tavily search succeeded', {
            query: summarizeQuery(query),
            resultCount: response.results.length
        });
        return {
            status: SEARCH_STATUS_SUCCESS,
            message: truncate(formatted, 4000)
        };
    } catch (err) {
        logger.error('Tavily search failed', err, {
            query: summarizeQuery(query)
        });
        return {
            status: SEARCH_STATUS_ERROR,
            reason: 'runtime',
            message: TAVILY_SEARCH_FAILED_MESSAGE
        };
    }
}

export async function searchDuckDuckGoWithDeps(query, httpClient) {
    const result = await executeDuckDuckGoSearch(query, httpClient);
    return result.message;
}

async function executeDuckDuckGoSearch(query, httpClient) {
    try {
        logger.info('Calling DuckDuckGo search', {
            query: summarizeQuery(query)
        });
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const res = await httpClient.get(url);

        const topics = Array.isArray(res.data?.RelatedTopics) ? res.data.RelatedTopics : [];
        const results = flattenDuckDuckGoTopics(topics)
            .filter(topic => topic?.Text)
            .slice(0, 5);

        if (!results.length) {
            logger.info('DuckDuckGo search returned no results', {
                query: summarizeQuery(query)
            });
            return {
                status: SEARCH_STATUS_NO_RESULTS,
                message: SEARCH_NO_RESULTS_MESSAGE
            };
        }

        logger.info('DuckDuckGo search succeeded', {
            query: summarizeQuery(query),
            resultCount: results.length
        });
        return {
            status: SEARCH_STATUS_SUCCESS,
            message: results.map(topic => topic.Text).join('\n')
        };
    } catch (err) {
        logger.error('DuckDuckGo search failed', err, {
            query: summarizeQuery(query)
        });
        return {
            status: SEARCH_STATUS_ERROR,
            message: DDG_SEARCH_FAILED_MESSAGE
        };
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
        let clean = rawText.replace(/<think[\s\S]*?<\/think>/gi, '').trim();

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

        if (typeof content === 'string') {
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
        if (typeof msg?.content === 'string') {
            const cleaned = stripThinkTags(msg.content).trim();
            if (cleaned.length > 0) {
                return cleaned;
            }
        }
        return null;
    }

    // ③ generate互換
    if (typeof data.response === 'string') {
        const cleaned = stripThinkTags(data.response).trim();
        if (cleaned.length > 0) {
            return cleaned;
        }
    }

    return null;
}

function hasThinkingOnlyResponse(data) {
    const content = data?.message?.content;
    const thinking = data?.message?.thinking;

    return (
        typeof content === 'string' &&
        content.trim().length === 0 &&
        typeof thinking === 'string' &&
        thinking.trim().length > 0
    );
}

function summarizeResponseShape(data) {
    if (!data || typeof data !== 'object') {
        return data;
    }

    return {
        model: data.model,
        created_at: data.created_at,
        done: data.done,
        done_reason: data.done_reason,
        message: data.message
            ? {
                  role: data.message.role,
                  contentLength:
                      typeof data.message.content === 'string' ? data.message.content.length : null,
                  thinkingLength:
                      typeof data.message.thinking === 'string'
                          ? data.message.thinking.length
                          : null
              }
            : undefined,
        choices: Array.isArray(data.choices) ? data.choices.length : undefined,
        hasResponse: typeof data.response === 'string'
    };
}

async function requestAssistantContentWithRetry(client, payload) {
    const res = await postChat(client, payload, { think: true });
    const content = extractAssistantMessage(res.data);

    if (content !== null) {
        return { content, data: res.data };
    }

    if (!shouldRetryThinkingOnlyResponse(res.data)) {
        return { content: null, data: res.data };
    }

    const retryOptions = buildThinkingRetryOptions(payload.options);
    if (!retryOptions) {
        return { content: null, data: res.data };
    }

    logger.warn('Assistant response exhausted in thinking mode, retrying', {
        ...summarizeResponseShape(res.data),
        retry_num_predict: retryOptions.num_predict
    });

    const retryRes = await postChat(
        client,
        {
            ...payload,
            options: retryOptions
        },
        { think: true }
    );

    return {
        content: extractAssistantMessage(retryRes.data),
        data: retryRes.data
    };
}

function shouldRetryThinkingOnlyResponse(data) {
    return hasThinkingOnlyResponse(data) && data?.done_reason === 'length';
}

function buildThinkingRetryOptions(options = {}) {
    const current = Number.isFinite(options?.num_predict) ? options.num_predict : 8192;
    const next = Math.min(
        Math.max(current * 2, current + THINKING_RETRY_MIN_BUMP),
        THINKING_RETRY_MAX_NUM_PREDICT
    );

    if (next <= current) {
        return null;
    }

    return {
        ...options,
        num_predict: next
    };
}

/* ===================================================== */

function stripThinkTags(text) {
    if (!text) return text;

    return text
        .replace(/<think[\s\S]*?<\/think>/gi, '')
        .replace(/<tool_call[\s\S]*?<\/tool_call>/gi, '')
        .replace(/<tool_call[\s\S]*?<\/think>/gi, '') // 壊れたタグ対策
        .trim();
}

export function truncate(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function summarizeQuery(query, maxLength = 120) {
    return truncate(
        String(query || '')
            .replace(/\s+/g, ' ')
            .trim(),
        maxLength
    );
}

function flattenDuckDuckGoTopics(topics = []) {
    return topics.flatMap(topic => (Array.isArray(topic?.Topics) ? topic.Topics : [topic]));
}

async function streamToString(stream) {
    if (typeof stream === 'string') return stream;
    if (typeof stream === 'object' && stream !== null && !stream[Symbol.asyncIterator]) {
        return JSON.stringify(stream);
    }
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    }
    return chunks.join('');
}

/* ===================================================== */
/* 設定値とデフォルトクライアント */
/* ===================================================== */

export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3.5:9b';
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';

const defaultClient = createOllamaClient({ baseURL: OLLAMA_BASE_URL });

export async function generateResponse(prompt, history, model = OLLAMA_MODEL) {
    return await defaultClient.generate({
        model,
        prompt,
        history
    });
}

async function summarizeHistory(client, model, history) {
    if (!history?.length) return null;

    const messages = [
        {
            role: 'system',
            content:
                '以下の会話履歴を簡潔に要約してください。重要な事実・前提・未解決事項を保持してください。'
        },
        {
            role: 'user',
            content: history.map(m => `${m.role}: ${m.text}`).join('\n')
        }
    ];

    const res = await postChat(
        client,
        {
            model,
            messages,
            stream: false,
            options: {
                temperature: 0,
                num_predict: 512
            }
        },
        { think: false }
    );

    return extractAssistantMessage(res.data);
}

function getModelOptions(model) {
    const defaults = {
        num_ctx: 16384,
        num_predict: 8192,
        temperature: 0.3
    };

    const cfg = MODEL_CONFIG[model];

    if (!cfg || typeof cfg !== 'object') {
        return defaults;
    }

    return {
        ...defaults,
        ...cfg
    };
}

export function createHttpClient({
    baseURL,
    timeout = DEFAULT_REQUEST_TIMEOUT_MS,
    fetchImpl = fetch
} = {}) {
    return {
        post: async (resource, data) =>
            requestJson({
                url: resolveRequestUrl(baseURL, resource),
                method: 'POST',
                json: data,
                timeout,
                fetchImpl
            }),
        get: async resource =>
            requestJson({
                url: resolveRequestUrl(baseURL, resource),
                method: 'GET',
                timeout,
                fetchImpl
            })
    };
}

function resolveRequestUrl(baseURL, resource) {
    if (/^https?:\/\//i.test(resource)) {
        return resource;
    }

    if (!baseURL) {
        return resource;
    }

    return new URL(resource, ensureTrailingSlash(baseURL)).toString();
}

function ensureTrailingSlash(url) {
    return url.endsWith('/') ? url : `${url}/`;
}

async function postChat(client, payload, { think = true } = {}) {
    try {
        return await client.post('/api/chat', {
            think,
            ...payload
        });
    } catch (err) {
        if (isUnsupportedThinkParameterError(err)) {
            logger.warn(
                'Chat endpoint does not support the think parameter. Retrying without it.',
                {
                    model: payload.model
                }
            );
            return await client.post('/api/chat', payload);
        }

        throw err;
    }
}

function isUnsupportedThinkParameterError(err) {
    const raw =
        typeof err?.response?.data === 'string' ? err.response.data : err?.response?.data?.error;

    const message = [err?.message, raw].filter(Boolean).join(' ');

    return (
        /unknown field\s+"?think"?/i.test(message) ||
        /unmarshal.*think/i.test(message) ||
        /invalid.*think/i.test(message)
    );
}

export async function requestJson({ url, method, json, timeout, fetchImpl = fetch }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetchImpl(url, {
            method,
            headers: json ? { 'content-type': 'application/json' } : undefined,
            body: json ? JSON.stringify(json) : undefined,
            signal: controller.signal
        });

        const data = await parseResponseBody(response);

        if (!response.ok) {
            const error = new Error(`Request failed with status ${response.status}`);
            error.response = {
                status: response.status,
                data
            };
            throw error;
        }

        return { data };
    } catch (err) {
        if (err.name === 'AbortError') {
            const timeoutError = new Error(`Request timed out after ${timeout}ms`);
            timeoutError.cause = err;
            throw timeoutError;
        }

        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function parseResponseBody(response) {
    const text = await response.text();

    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}
