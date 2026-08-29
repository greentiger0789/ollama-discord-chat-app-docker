import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tavily } from '@tavily/core';
import * as yaml from 'js-yaml';
import fetch from 'node-fetch';
import { createLogger } from './logger.ts';
import {
    decisionPrompt,
    MULTI_USER_SYSTEM_PROMPT,
    pickSearchNotice,
    SUMMARY_PROMPT,
    SYSTEM_PROMPT
} from './prompts.ts';
import { formatEntryForLlm, isMultiUserHistory, sanitizeSpeakerName } from './speakerUtils.ts';
import type { HistoryEntry } from './threadManager.ts';

type SearchEngine = 'tavily' | 'ddg';

export interface SearchPlan {
    needSearch: boolean;
    engine: SearchEngine;
    searchQuery: string;
}

type SearchRequestPlan = Pick<SearchPlan, 'engine' | 'searchQuery'> &
    Partial<Pick<SearchPlan, 'needSearch'>>;

interface RequestOptions {
    signal?: AbortSignal | undefined;
}

export interface HttpResponse {
    data: unknown;
}

export interface HttpPostClient {
    post(resource: string, data: unknown, options?: RequestOptions): Promise<HttpResponse>;
}

export interface HttpGetClient {
    get(resource: string, options?: RequestOptions): Promise<HttpResponse>;
}

export interface HttpClient extends HttpPostClient, HttpGetClient {}

interface ModelOptions extends Record<string, unknown> {
    num_ctx?: number;
    num_predict?: number;
    temperature?: number;
}

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface ChatPayload {
    model: string;
    messages: ChatMessage[];
    stream: false;
    format?: string;
    options: ModelOptions;
}

interface TavilyClient {
    search(
        query: string,
        options: { searchDepth: 'advanced'; maxResults: number; includeAnswer: false }
    ): Promise<unknown>;
}

type SearchResult =
    | { status: 'success'; message: string }
    | { status: 'no_results'; message: string }
    | { status: 'error'; message: string; reason?: string };

interface ResponseLike {
    ok: boolean;
    status?: number;
    text(): Promise<string>;
}

interface FetchRequestInit {
    method: string;
    headers?: Record<string, string>;
    body?: string;
    signal: AbortSignal;
}

export type FetchLike = (url: string, init: FetchRequestInit) => Promise<ResponseLike>;

export interface GenerateOptions {
    model?: string;
    prompt?: string;
    history?: readonly HistoryEntry[];
    speaker?: string | undefined;
    signal?: AbortSignal | undefined;
}

export interface GenerateResponseOptions {
    model?: string;
    speaker?: string | undefined;
    signal?: AbortSignal | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseModelConfig(value: unknown): Record<string, ModelOptions> {
    if (!isRecord(value)) return {};

    const parsed: Record<string, ModelOptions> = {};
    for (const [model, options] of Object.entries(value)) {
        if (isRecord(options)) parsed[model] = options;
    }
    return parsed;
}

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
const SEARCH_STATUS_SUCCESS = 'success' as const;
const SEARCH_STATUS_NO_RESULTS = 'no_results' as const;
const SEARCH_STATUS_ERROR = 'error' as const;
const EXPLICIT_WEB_SEARCH_PATTERNS = [
    /(?:web|ウェブ|ネット|インターネット)(?:上)?(?:で|を|から)?[^。！？\n]{0,20}(?:検索|調べ|調査|確認|探)/iu,
    /(?:ググ|googleで|duckduckgoで)(?:って|検索|調べ|調査|確認|探)/iu,
    /(?:出典|情報源|外部ソース)(?:を|も)?[^。！？\n]{0,12}(?:検索|調べ|確認|探|提示)/u
];
const logger = createLogger('ollamaClient');
let MODEL_CONFIG: Record<string, ModelOptions> = {};

try {
    const MODEL_CONFIG_PATH = MODEL_CONFIG_CANDIDATES.find(candidate => fs.existsSync(candidate));
    if (!MODEL_CONFIG_PATH) {
        throw new Error(`No config found in: ${MODEL_CONFIG_CANDIDATES.join(', ')}`);
    }
    const file = fs.readFileSync(MODEL_CONFIG_PATH, 'utf8');
    const parsed: unknown = yaml.load(file);
    MODEL_CONFIG = parseModelConfig(isRecord(parsed) ? parsed.models : undefined);
    logger.info('Loaded model config', {
        path: MODEL_CONFIG_PATH,
        modelCount: Object.keys(MODEL_CONFIG).length
    });
} catch (err) {
    logger.warn('Model config load failed. Using defaults.', err, {
        candidates: MODEL_CONFIG_CANDIDATES
    });
}

function createTavilyClient(apiKey = process.env.TAVILY_API_KEY): TavilyClient | null {
    if (!apiKey) {
        return null;
    }

    return tavily({ apiKey });
}

// デフォルトの検索関数
type SearchFunction = (plan: SearchPlan, options?: RequestOptions) => Promise<string>;

const defaultSearchFn: SearchFunction = async (plan, { signal } = {}) =>
    executeSearchWithDeps(plan, createTavilyClient(), createHttpClient(), { signal });

export default function createOllamaClient({
    baseURL = 'http://ollama:11434',
    searchFn = defaultSearchFn,
    httpClient = createHttpClient({ baseURL, timeout: DEFAULT_REQUEST_TIMEOUT_MS })
}: {
    baseURL?: string;
    searchFn?: SearchFunction;
    httpClient?: HttpPostClient;
} = {}) {
    const client = httpClient;

    async function generate({
        model = 'qwen3.5:9b',
        prompt = '',
        history = [],
        speaker,
        signal
    }: GenerateOptions = {}): Promise<string> {
        /* =========================================
           ① トークン概算（かなり安全寄り）
        ========================================= */

        function estimateTokensFromText(text: string): number {
            if (!text) return 0;
            return Math.ceil(text.length / 3); // 日本語LLM向けの緩い概算
        }

        function estimateTokensFromHistory(
            hist: readonly HistoryEntry[],
            multiUser: boolean
        ): number {
            return hist.reduce((sum, m) => {
                return sum + estimateTokensFromText(formatEntryForLlm(m, multiUser).content);
            }, 0);
        }

        const MAX_CONTEXT_TOKENS = 12000; // num_ctx 16384を考慮
        const SAFETY_MARGIN = 2000; // 推論thinking余白
        const LIMIT = MAX_CONTEXT_TOKENS - SAFETY_MARGIN;

        let processedHistory = [...history];

        /* =========================================
           ② 履歴が閾値を超えたら要約
        ========================================= */

        const currentEntry: HistoryEntry = {
            role: 'user',
            text: prompt,
            ...(speaker === undefined ? {} : { speaker })
        };
        const multiUser = isMultiUserHistory([...history, currentEntry]);
        const historyTokens = estimateTokensFromHistory(history, multiUser);
        const promptTokens = estimateTokensFromText(
            formatEntryForLlm(currentEntry, multiUser).content
        );

        if (historyTokens + promptTokens > LIMIT && history.length > 1) {
            // 🔥 最新userは除外
            const oldHistory = history.slice(0, -1);
            logger.info('Summarizing conversation history', {
                model,
                historyCount: history.length,
                estimatedTokens: historyTokens + promptTokens,
                limit: LIMIT
            });

            const summary = await summarizeHistory(client, model, oldHistory, multiUser, {
                signal
            });

            const latestEntry = history.at(-1);
            processedHistory = [
                {
                    role: 'assistant',
                    text: `【過去の会話要約】\n${summary}`
                },
                ...(latestEntry ? [latestEntry] : [])
            ];
        }

        /* =========================================
           ③ 検索判定
        ========================================= */

        throwIfAborted(signal);
        const plan = await decideSearchPlan(client, model, prompt, { signal });

        let searchResults = '';
        if (plan.needSearch) {
            searchResults = await searchFn(plan, { signal });
        }
        throwIfAborted(signal);

        // 検索を実行した場合は返信の先頭に検索済みである旨を付与
        const didSearch = plan.needSearch && !!searchResults;

        /* =========================================
           ④ 最終メッセージ構築
        ========================================= */

        const finalMessages: ChatMessage[] = [
            {
                role: 'system',
                content: multiUser
                    ? `${SYSTEM_PROMPT}\n\n${MULTI_USER_SYSTEM_PROMPT}`
                    : SYSTEM_PROMPT
            },
            ...processedHistory.map(m => formatEntryForLlm(m, multiUser)),
            {
                role: 'user',
                content: formatEntryForLlm(
                    {
                        role: 'user',
                        text:
                            plan.needSearch && searchResults
                                ? buildAugmentedPrompt(prompt, searchResults)
                                : prompt,
                        ...(speaker === undefined ? {} : { speaker })
                    },
                    multiUser
                ).content
            }
        ];

        /* =========================================
           ⑤ 本推論
        ========================================= */

        try {
            const modelOptions = getModelOptions(model);
            const { content, data } = await requestAssistantContentWithRetry(
                client,
                {
                    model,
                    messages: finalMessages,
                    stream: false,
                    options: modelOptions
                },
                { signal }
            );

            if (content !== null) {
                return didSearch ? prependSearchNotice(content) : content;
            }

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
            if (isResponseAbortedError(err)) {
                throw err;
            }
            if (isHttpError(err) && err.response.data) {
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

async function decideSearchPlan(
    client: HttpPostClient,
    model: string,
    prompt: string,
    { signal }: RequestOptions = {}
): Promise<SearchPlan> {
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

    const hasFreshnessKeyword = forceKeywords.some(k => prompt.includes(k));
    // 明示的なWeb検索依頼は、判定モデルが静的知識だと誤認しても尊重する。
    const hasExplicitWebSearchRequest = EXPLICIT_WEB_SEARCH_PATTERNS.some(pattern =>
        pattern.test(prompt)
    );
    const hasForceKeyword = hasFreshnessKeyword || hasExplicitWebSearchRequest;

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
            { think: false, signal }
        );

        const raw = getAssistantContentValue(res.data) ?? '{}';

        const parsed = safeJsonParse(raw);
        const plan: SearchPlan = {
            needSearch: hasForceKeyword || !!parsed.needSearch,
            engine: parsed.engine === 'ddg' ? 'ddg' : 'tavily',
            searchQuery:
                typeof parsed.searchQuery === 'string' && parsed.searchQuery
                    ? parsed.searchQuery
                    : prompt
        };
        logger.info('Search plan decided', {
            model,
            needSearch: plan.needSearch,
            engine: plan.engine,
            forcedByKeyword: hasForceKeyword,
            explicitSearchRequest: hasExplicitWebSearchRequest,
            query: summarizeQuery(plan.searchQuery)
        });
        return plan;
    } catch (err) {
        if (isResponseAbortedError(err)) {
            throw err;
        }
        const fallbackPlan: SearchPlan = {
            needSearch: hasForceKeyword,
            engine: 'tavily',
            searchQuery: prompt
        };
        logger.warn('Search plan generation failed. Using fallback plan.', err, {
            model,
            needSearch: fallbackPlan.needSearch,
            engine: fallbackPlan.engine,
            forcedByKeyword: hasForceKeyword,
            explicitSearchRequest: hasExplicitWebSearchRequest,
            query: summarizeQuery(fallbackPlan.searchQuery)
        });
        return fallbackPlan;
    }
}

/* ===================================================== */
/* 🌐 検索（依存関係注入版）
/* ===================================================== */

export async function executeSearchWithDeps(
    plan: SearchRequestPlan,
    tavilyClient: TavilyClient | null,
    httpClient: HttpGetClient,
    { signal }: RequestOptions = {}
): Promise<string> {
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
        return await searchDuckDuckGoWithDeps(plan.searchQuery, httpClient, { signal });
    }

    logger.info('Using Tavily for web search', {
        query: summarizeQuery(plan.searchQuery)
    });

    const tavilyResult = await executeTavilySearch(plan.searchQuery, tavilyClient);
    if (tavilyResult.status !== SEARCH_STATUS_ERROR) {
        return tavilyResult.message;
    }

    logger.warn('Tavily search failed. Falling back to DuckDuckGo.', {
        query: summarizeQuery(plan.searchQuery),
        reason: tavilyResult.reason || 'unknown'
    });
    const ddgResult = await executeDuckDuckGoSearch(plan.searchQuery, httpClient, { signal });

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

export async function searchTavilyWithDeps(
    query: string,
    tavilyClient: TavilyClient | null
): Promise<string> {
    const result = await executeTavilySearch(query, tavilyClient);
    return result.message;
}

async function executeTavilySearch(
    query: string,
    tavilyClient: TavilyClient | null
): Promise<SearchResult> {
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
        const response: unknown = await tavilyClient.search(query, {
            searchDepth: 'advanced',
            maxResults: 5,
            includeAnswer: false
        });

        const results =
            isRecord(response) && Array.isArray(response.results)
                ? response.results.filter(isRecord)
                : [];
        if (!results.length) {
            logger.info('Tavily search returned no results', {
                query: summarizeQuery(query)
            });
            return {
                status: SEARCH_STATUS_NO_RESULTS,
                message: SEARCH_NO_RESULTS_MESSAGE
            };
        }

        const formatted = results
            .map(
                r =>
                    `タイトル: ${typeof r.title === 'string' ? r.title : ''}
内容: ${truncate(typeof r.content === 'string' ? r.content : '', 500)}
URL: ${typeof r.url === 'string' ? r.url : ''}`
            )
            .join('\n\n');

        logger.info('Tavily search succeeded', {
            query: summarizeQuery(query),
            resultCount: results.length
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

export async function searchDuckDuckGoWithDeps(
    query: string,
    httpClient: HttpGetClient,
    { signal }: RequestOptions = {}
): Promise<string> {
    const result = await executeDuckDuckGoSearch(query, httpClient, { signal });
    return result.message;
}

async function executeDuckDuckGoSearch(
    query: string,
    httpClient: HttpGetClient,
    { signal }: RequestOptions = {}
): Promise<SearchResult> {
    try {
        logger.info('Calling DuckDuckGo search', {
            query: summarizeQuery(query)
        });
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const res = await httpClient.get(url, { signal });

        const topics =
            isRecord(res.data) && Array.isArray(res.data.RelatedTopics)
                ? res.data.RelatedTopics
                : [];
        const results = flattenDuckDuckGoTopics(topics).filter(hasDuckDuckGoText).slice(0, 5);

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
/* 🔍 検索済み通知の接頭辞付与 */
/* ===================================================== */

function prependSearchNotice(content: string): string {
    const notice = pickSearchNotice();
    if (!notice || content.startsWith(notice)) {
        return content;
    }
    return `${notice}\n\n${content}`;
}

/* ===================================================== */
/* 🧠 検索統合プロンプト */
/* ===================================================== */

function buildAugmentedPrompt(originalPrompt: string, searchResults: string): string {
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

function safeJsonParse(rawText: string): Record<string, unknown> {
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

        const parsed: unknown = JSON.parse(clean);
        return isRecord(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

/* ===================================================== */
/* 🤖 レスポンス統合抽出 */
/* ===================================================== */

function getAssistantContentValue(data: unknown): string | null {
    if (!isRecord(data)) return null;

    if (isRecord(data.message) && typeof data.message.content === 'string') {
        return data.message.content;
    }

    if (Array.isArray(data.choices)) {
        const firstChoice = data.choices[0];
        if (
            isRecord(firstChoice) &&
            isRecord(firstChoice.message) &&
            typeof firstChoice.message.content === 'string'
        ) {
            return firstChoice.message.content;
        }
    }

    return null;
}

function extractAssistantMessage(data: unknown): string | null {
    if (!isRecord(data)) return null;

    // ① Ollama標準
    if (isRecord(data.message)) {
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
    if (Array.isArray(data.choices) && data.choices.length) {
        const choice = data.choices[0];
        const msg = isRecord(choice) && isRecord(choice.message) ? choice.message : null;
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

function hasThinkingOnlyResponse(data: unknown): boolean {
    if (!isRecord(data) || !isRecord(data.message)) return false;
    const content = data.message.content;
    const thinking = data.message.thinking;

    return (
        typeof content === 'string' &&
        content.trim().length === 0 &&
        typeof thinking === 'string' &&
        thinking.trim().length > 0
    );
}

function summarizeResponseShape(data: unknown): Record<string, unknown> {
    if (!isRecord(data)) {
        return { value: data };
    }

    const message = isRecord(data.message) ? data.message : null;

    return {
        model: data.model,
        created_at: data.created_at,
        done: data.done,
        done_reason: data.done_reason,
        message: message
            ? {
                  role: message.role,
                  contentLength:
                      typeof message.content === 'string' ? message.content.length : null,
                  thinkingLength:
                      typeof message.thinking === 'string' ? message.thinking.length : null
              }
            : undefined,
        choices: Array.isArray(data.choices) ? data.choices.length : undefined,
        hasResponse: typeof data.response === 'string'
    };
}

async function requestAssistantContentWithRetry(
    client: HttpPostClient,
    payload: ChatPayload,
    { signal }: RequestOptions = {}
): Promise<{ content: string | null; data: unknown }> {
    const res = await postChat(client, payload, { think: true, signal });
    const content = extractAssistantMessage(res.data);

    if (content !== null) {
        return { content, data: res.data };
    }

    if (!shouldRetryThinkingOnlyResponse(res.data)) {
        return { content: null, data: res.data };
    }

    throwIfAborted(signal);

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
        { think: true, signal }
    );

    return {
        content: extractAssistantMessage(retryRes.data),
        data: retryRes.data
    };
}

function shouldRetryThinkingOnlyResponse(data: unknown): boolean {
    return hasThinkingOnlyResponse(data) && isRecord(data) && data.done_reason === 'length';
}

function buildThinkingRetryOptions(options: ModelOptions = {}): ModelOptions | null {
    const current =
        typeof options.num_predict === 'number' && Number.isFinite(options.num_predict)
            ? options.num_predict
            : 8192;
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

function stripThinkTags(text: string): string {
    if (!text) return text;

    return text
        .replace(/<think[\s\S]*?<\/think>/gi, '')
        .replace(/<tool_call[\s\S]*?<\/tool_call>/gi, '')
        .replace(/<tool_call[\s\S]*?<\/think>/gi, '') // 壊れたタグ対策
        .trim();
}

export function truncate(text: string, maxLength: number): string {
    if (!text) return '';
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function summarizeQuery(query: unknown, maxLength = 120): string {
    return truncate(
        String(query || '')
            .replace(/\s+/g, ' ')
            .trim(),
        maxLength
    );
}

function flattenDuckDuckGoTopics(topics: unknown[] = []): Record<string, unknown>[] {
    return topics.flatMap(topic => {
        if (!isRecord(topic)) return [];
        return Array.isArray(topic.Topics) ? flattenDuckDuckGoTopics(topic.Topics) : [topic];
    });
}

function hasDuckDuckGoText(
    topic: Record<string, unknown>
): topic is Record<string, unknown> & { Text: string } {
    return typeof topic.Text === 'string' && topic.Text.length > 0;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        Symbol.asyncIterator in value &&
        typeof value[Symbol.asyncIterator] === 'function'
    );
}

async function streamToString(stream: unknown): Promise<string> {
    if (typeof stream === 'string') return stream;
    if (!isAsyncIterable(stream)) {
        return JSON.stringify(stream) ?? String(stream);
    }
    const chunks: string[] = [];
    for await (const chunk of stream) {
        chunks.push(
            typeof chunk === 'string'
                ? chunk
                : Buffer.isBuffer(chunk)
                  ? chunk.toString('utf8')
                  : String(chunk)
        );
    }
    return chunks.join('');
}

/* ===================================================== */
/* 設定値とデフォルトクライアント */
/* ===================================================== */

export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3.5:9b';
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';

const defaultClient = createOllamaClient({ baseURL: OLLAMA_BASE_URL });
// summarizeHistory などの生 API 呼び出し用の HTTP クライアント
const defaultHttpClient = createHttpClient({
    baseURL: OLLAMA_BASE_URL,
    timeout: DEFAULT_REQUEST_TIMEOUT_MS
});

export async function generateResponse(
    prompt: string,
    history: readonly HistoryEntry[],
    modelOrOptions: string | GenerateResponseOptions = OLLAMA_MODEL
): Promise<string> {
    const { model, speaker, signal } =
        typeof modelOrOptions === 'string'
            ? { model: modelOrOptions }
            : {
                  model: modelOrOptions?.model ?? OLLAMA_MODEL,
                  speaker: modelOrOptions?.speaker,
                  signal: modelOrOptions?.signal
              };

    return await defaultClient.generate({
        model,
        prompt,
        history,
        ...(speaker === undefined ? {} : { speaker }),
        ...(signal === undefined ? {} : { signal })
    });
}

// 会話履歴を要約する（/o-summary コマンド用の公開 API）
export async function summarizeConversation(
    history: readonly HistoryEntry[],
    model = OLLAMA_MODEL
): Promise<string | null> {
    return await summarizeHistory(defaultHttpClient, model, history);
}

async function summarizeHistory(
    client: HttpPostClient,
    model: string,
    history: readonly HistoryEntry[],
    multiUser = isMultiUserHistory(history),
    { signal }: RequestOptions = {}
): Promise<string | null> {
    if (!history?.length) return null;

    const messages: ChatMessage[] = [
        {
            role: 'system',
            content: SUMMARY_PROMPT
        },
        {
            role: 'user',
            content: history
                .map(m => {
                    const speaker = multiUser ? sanitizeSpeakerName(m.speaker) : '';
                    return `${m.role}${speaker ? `(${speaker})` : ''}: ${m.text}`;
                })
                .join('\n')
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
        { think: false, signal }
    );

    return extractAssistantMessage(res.data);
}

function getModelOptions(model: string): ModelOptions {
    const defaults: ModelOptions = {
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
    fetchImpl = ((url, init) => fetch(url, init)) satisfies FetchLike
}: {
    baseURL?: string;
    timeout?: number;
    fetchImpl?: FetchLike;
} = {}): HttpClient {
    return {
        post: async (resource, data, { signal } = {}) =>
            requestJson({
                url: resolveRequestUrl(baseURL, resource),
                method: 'POST',
                json: data,
                timeout,
                fetchImpl,
                signal
            }),
        get: async (resource, { signal } = {}) =>
            requestJson({
                url: resolveRequestUrl(baseURL, resource),
                method: 'GET',
                timeout,
                fetchImpl,
                signal
            })
    };
}

function resolveRequestUrl(baseURL: string | undefined, resource: string): string {
    if (/^https?:\/\//i.test(resource)) {
        return resource;
    }

    if (!baseURL) {
        return resource;
    }

    return new URL(resource, ensureTrailingSlash(baseURL)).toString();
}

function ensureTrailingSlash(url: string): string {
    return url.endsWith('/') ? url : `${url}/`;
}

async function postChat(
    client: HttpPostClient,
    payload: ChatPayload,
    { think = true, signal }: RequestOptions & { think?: boolean } = {}
): Promise<HttpResponse> {
    try {
        return await client.post(
            '/api/chat',
            {
                think,
                ...payload
            },
            { signal }
        );
    } catch (err) {
        if (isUnsupportedThinkParameterError(err)) {
            logger.warn(
                'Chat endpoint does not support the think parameter. Retrying without it.',
                {
                    model: payload.model
                }
            );
            throwIfAborted(signal);
            return await client.post('/api/chat', payload, { signal });
        }

        throw err;
    }
}

interface HttpErrorResponse {
    status: number;
    data: unknown;
}

export class HttpError extends Error {
    response: HttpErrorResponse;

    constructor(message: string, response: HttpErrorResponse) {
        super(message);
        this.name = 'HttpError';
        this.response = response;
    }
}

interface HttpErrorLike {
    response: { data: unknown; status?: number };
}

function isHttpError(err: unknown): err is HttpErrorLike {
    return isRecord(err) && isRecord(err.response) && 'data' in err.response;
}

function isUnsupportedThinkParameterError(err: unknown): boolean {
    const responseData = isHttpError(err) ? err.response.data : undefined;
    const raw =
        typeof responseData === 'string'
            ? responseData
            : isRecord(responseData) && typeof responseData.error === 'string'
              ? responseData.error
              : undefined;

    const message = [err instanceof Error ? err.message : undefined, raw].filter(Boolean).join(' ');

    return (
        /unknown field\s+"?think"?/i.test(message) ||
        /unmarshal.*think/i.test(message) ||
        /invalid.*think/i.test(message)
    );
}

export class ResponseAbortedError extends Error {
    constructor(cause?: unknown) {
        super('Request aborted by user', { cause });
        this.name = 'ResponseAbortedError';
    }
}

export function isResponseAbortedError(err: unknown): err is ResponseAbortedError {
    return err instanceof Error && err.name === 'ResponseAbortedError';
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new ResponseAbortedError(signal.reason);
    }
}

export async function requestJson({
    url,
    method,
    json,
    timeout,
    signal,
    fetchImpl = ((requestUrl, init) => fetch(requestUrl, init)) satisfies FetchLike
}: {
    url: string;
    method: string;
    json?: unknown;
    timeout: number;
    signal?: AbortSignal | undefined;
    fetchImpl?: FetchLike;
}): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const combinedSignal = signal
        ? AbortSignal.any([controller.signal, signal])
        : controller.signal;

    try {
        const requestInit: FetchRequestInit = {
            method,
            signal: combinedSignal,
            ...(json
                ? {
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify(json)
                  }
                : {})
        };
        const response = await fetchImpl(url, requestInit);

        const data = await parseResponseBody(response);

        if (!response.ok) {
            const status = response.status ?? 0;
            throw new HttpError(`Request failed with status ${status}`, {
                status,
                data
            });
        }

        return { data };
    } catch (err) {
        if (signal?.aborted) {
            throw new ResponseAbortedError(err);
        }
        if (err instanceof Error && err.name === 'AbortError') {
            const timeoutError = new Error(`Request timed out after ${timeout}ms`);
            timeoutError.cause = err;
            throw timeoutError;
        }

        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function parseResponseBody(response: Pick<ResponseLike, 'text'>): Promise<unknown> {
    const text = await response.text();

    if (!text) {
        return null;
    }

    try {
        const parsed: unknown = JSON.parse(text);
        return parsed;
    } catch {
        return text;
    }
}
