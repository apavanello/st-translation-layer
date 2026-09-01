// Translation service: OpenAI-compatible chat completion calls with retry and
// error classification (SDD-1). Pure module — receives a config getter, touches
// no DOM and no SillyTavern context.

import { protectSegments, restoreSegments } from './protect.js';

const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

export class TranslationError extends Error {
    constructor(classification, cause) {
        super(`translation failed (${classification})`);
        this.classification = classification;
        this.cause = cause;
    }
}

const SYSTEM_TO_EN = `You are a translation engine. Translate the user's message into English.
Rules:
- Return ONLY the translation. No preamble, no quotes, no commentary.
- If the message is already in English, return it unchanged.
- Preserve formatting exactly: *asterisks*, "quotes", line breaks, lists, markdown.
- Never translate tokens that look like ⟦TL0⟧ ⟦TL1⟧ … — copy them verbatim.
- Translate tone, slang and style faithfully (keep it casual if casual).`;

const systemFromEn = (language) => `You are a translation engine. Translate the user's message into ${language}.
Rules:
- Return ONLY the translation. No preamble, no quotes, no commentary.
- If the message is already in ${language}, return it unchanged.
- Preserve formatting exactly: *asterisks*, "quotes", line breaks, lists, markdown.
- Never translate tokens that look like ⟦TL0⟧ ⟦TL1⟧ … — copy them verbatim.
- Keep proper names, character names, onomatopoeia and emojis exactly as written.
- Translate tone, slang and style faithfully.`;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(baseUrl) {
    let url = baseUrl.trim().replace(/\/+$/, '');
    if (url.endsWith('/chat/completions')) {
        url = url.slice(0, -'/chat/completions'.length);
    }
    return url;
}

function estimateMaxTokens(text) {
    return Math.max(1024, Math.round(text.length / 3) * 2);
}

function classifyHttp(status) {
    if (status === 401 || status === 403) return 'auth';
    if (status === 429) return 'rate_limit';
    if (status >= 500) return 'server';
    return 'bad_output';
}

/**
 * @param {() => {baseUrl: string, apiKey: string, model: string, language: string, viaSt: boolean}} getConfig
 * @param {{getHeaders?: () => object}} [transport] same-origin headers when relaying through the ST server
 */
export function createTranslationService(getConfig, { getHeaders } = {}) {
    async function callOnce(messages, maxTokens) {
        const { baseUrl, apiKey, model, viaSt } = getConfig();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
            let response;
            if (viaSt) {
                // Relay through the SillyTavern server: avoids browser CORS for
                // translator endpoints that don't send Access-Control-Allow-Origin.
                // The ST backend forwards `reverse_proxy` + `proxy_password` to any
                // OpenAI-compatible target (src/endpoints/backends/chat-completions.js).
                response = await fetch('/api/backends/chat-completions/generate', {
                    method: 'POST',
                    headers: {
                        ...(getHeaders ? getHeaders() : {}),
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        chat_completion_source: 'openai',
                        reverse_proxy: normalizeBaseUrl(baseUrl),
                        proxy_password: apiKey,
                        model,
                        temperature: 0.2,
                        stream: false,
                        max_tokens: maxTokens,
                        messages,
                    }),
                    signal: controller.signal,
                });
            } else {
                response = await fetch(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
                    },
                    body: JSON.stringify({
                        model,
                        temperature: 0.2,
                        stream: false,
                        max_tokens: maxTokens,
                        messages,
                    }),
                    signal: controller.signal,
                });
            }
            if (!response.ok) {
                throw new TranslationError(classifyHttp(response.status), `HTTP ${response.status}`);
            }
            const data = await response.json();
            const content = data?.choices?.[0]?.message?.content?.trim();
            if (!content) {
                // Some endpoints answer HTTP 200 with an in-band error object.
                const upstreamError = data?.error?.message ?? data?.error;
                throw new TranslationError('bad_output', upstreamError ? String(upstreamError) : 'empty completion');
            }
            return { content, finishReason: data?.choices?.[0]?.finish_reason };
        } catch (error) {
            if (error instanceof TranslationError) throw error;
            throw new TranslationError('network', error);
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Retries transient failures; on truncation doubles the token budget
     * (up to twice) instead of failing, since the translation itself is fine
     * evidence that the connection works.
     */
    async function callWithRetry(messages, maxTokens, { tolerateTruncation = false } = {}) {
        const { baseUrl, model } = getConfig();
        if (!baseUrl || !model) {
            throw new TranslationError('not_configured', 'baseUrl/model missing');
        }
        let budget = maxTokens;
        let doublings = 0;
        let attempt = 0;
        let lastError;
        while (attempt < MAX_ATTEMPTS) {
            attempt++;
            try {
                const { content, finishReason } = await callOnce(messages, budget);
                if (finishReason === 'length' && !tolerateTruncation && doublings < 2) {
                    budget *= 2;
                    doublings++;
                    continue;
                }
                return content;
            } catch (error) {
                lastError = error;
                const retryable = error.classification !== 'auth' && error.classification !== 'not_configured';
                if (!retryable || attempt >= MAX_ATTEMPTS) break;
                const base = error.classification === 'rate_limit' ? 3 ** attempt : attempt;
                await sleep(base * 1000 + Math.random() * 400);
            }
        }
        throw lastError;
    }

    /**
     * @param {string} text
     * @param {{direction: 'user->en'|'en->user'}} options
     * @returns {Promise<string>} translated text with protected segments restored
     */
    async function translate(text, { direction }) {
        const { language } = getConfig();
        const { masked, segments } = protectSegments(text);
        const system = direction === 'user->en' ? SYSTEM_TO_EN : systemFromEn(language);
        let translated = await callWithRetry(
            [
                { role: 'system', content: system },
                { role: 'user', content: masked },
            ],
            estimateMaxTokens(text),
        );
        const restored = restoreSegments(translated, segments);
        if (restored.warnings.length) {
            console.debug('[Translation Layer] placeholders lost by translator:', restored.warnings);
        }
        translated = restored.text;
        return translated;
    }

    async function testConnection() {
        const started = performance.now();
        try {
            // A valid non-empty completion proves the connection; a chatty model
            // hitting the small budget is fine here (truncation is tolerated).
            const content = await callWithRetry(
                [
                    { role: 'system', content: SYSTEM_TO_EN },
                    { role: 'user', content: 'Translate to English: "olá"' },
                ],
                256,
                { tolerateTruncation: true },
            );
            return { ok: true, latencyMs: Math.round(performance.now() - started), sample: content };
        } catch (error) {
            return { ok: false, error: error.classification, cause: String(error.cause ?? error.message) };
        }
    }

    return { translate, testConnection };
}
