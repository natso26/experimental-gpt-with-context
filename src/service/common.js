import tokenizer from '../repository/llm/tokenizer.js';
import embedding from '../repository/llm/embedding.js';
import chat from '../repository/llm/chat.js';
import wolframAlpha from '../repository/web/wolframAlpha.js';
import serp from '../repository/web/serp.js';
import scraper from '../repository/web/scraper.js';
import number from '../util/number.js';
import strictParse from '../util/strictParse.js';
import log from '../util/log.js';

const DOC_ID = {
    from: (userId, sessionId) => `${userId}_${sessionId}`,
    parse: (docId) => {
        const [userId, sessionId] = docId.split('_');
        return {userId, sessionId};
    },
};
const KIND_FIELD = 'kind';
const RECURSED_NOTE_FIELD = 'recursedNote';
const RECURSED_QUERY_FIELD = 'recursedQuery';
const QUERY_FIELD = 'query';
const QUERY_EMBEDDING_FIELD = 'queryEmbedding';
const REPLY_FIELD = 'reply';
const REPLY_EMBEDDING_FIELD = 'replyEmbedding';
const SUMMARY_FIELD = 'summary';
const SUMMARY_EMBEDDING_FIELD = 'summaryEmbedding';
const INTROSPECTION_FIELD = 'introspection';
const INTROSPECTION_EMBEDDING_FIELD = 'introspectionEmbedding';
const IMAGINATION_FIELD = 'imagination';
const IMAGINATION_EMBEDDING_FIELD = 'imaginationEmbedding';
const MODEL_PROMPT_CORE_MSG = 'Be authentic.';
const MODEL_PROMPT_EXTERNAL_COMPONENT_MSG = 'This is an external component.';
const MODEL_PROMPT_INTERNAL_COMPONENT_MSG = 'This is an internal component.';
const MODEL_PROMPT_FORMATTED_TIME = () => new Date().toISOString();
const EMBED_RETRY_COUNT = strictParse.int(process.env.EMBED_REPOSITORY_RETRY_COUNT);
const CHAT_RETRY_COUNT = strictParse.int(process.env.CHAT_REPOSITORY_RETRY_COUNT);
const WOLFRAM_ALPHA_QUERY_RETRY_COUNT = strictParse.int(process.env.WOLFRAM_ALPHA_QUERY_REPOSITORY_RETRY_COUNT);
const SERP_SEARCH_RETRY_COUNT = strictParse.int(process.env.SERP_SEARCH_REPOSITORY_RETRY_COUNT);
const SCRAPER_EXTRACT_RETRY_COUNT = strictParse.int(process.env.SCRAPER_EXTRACT_REPOSITORY_RETRY_COUNT);
const CHAT_COST = (() => {
    const f = (inTokens, outTokens) => number.round(inTokens * 1e-5 + outTokens * 3e-5, 5);
    f.sum = (arr) => number.round(number.sum(arr), 5);
    return f;
})();

// NB: abs rather than linear scaling
const absCosineSimilarity = (a, b) => {
    let sim = 0;
    for (let i = 0; i < a.length; i++) {
        sim += a[i] * b[i];
    }
    return Math.abs(sim);
};

const retry = (fn, onError) => async (...args) => {
    let cnt = 0;
    while (true) {
        try {
            return await fn(...args);
        } catch (e) {
            const isContinue = onError(e, cnt);
            if (!isContinue) {
                throw e;
            }
            cnt++;
        }
    }
};

const embedWithRetry = retry(embedding.embed, (e, cnt) => {
    log.log(`embed repository failed, retry count: ${cnt}`,
        {cnt, error: e.message || '', stack: e.stack || ''});
    return cnt < EMBED_RETRY_COUNT;
});

const chatWithRetry = retry(chat.chat, (e, cnt) => {
    log.log(`chat repository failed, retry count: ${cnt}`,
        {cnt, error: e.message || '', stack: e.stack || ''});
    return cnt < CHAT_RETRY_COUNT;
});

const wolframAlphaQueryWithRetry = retry(wolframAlpha.query, (e, cnt) => {
    log.log(`wolfram alpha query repository failed, retry count: ${cnt}`,
        {cnt, error: e.message || '', stack: e.stack || ''});
    return cnt < WOLFRAM_ALPHA_QUERY_RETRY_COUNT;
});

const serpSearchWithRetry = retry(serp.search, (e, cnt) => {
    log.log(`serp search repository failed, retry count: ${cnt}`,
        {cnt, error: e.message || '', stack: e.stack || ''});
    return cnt < SERP_SEARCH_RETRY_COUNT;
});

const scraperExtractWithRetry = retry(scraper.extract, (e, cnt) => {
    log.log(`scraper extract repository failed, retry count: ${cnt}`,
        {cnt, error: e.message || '', stack: e.stack || ''});
    return cnt < SCRAPER_EXTRACT_RETRY_COUNT;
});

const shortCircuitAutocompleteContentHook = (correlationId, prefixTokenCount) => {
    const m = mapDropConflict();
    const f = ({content, toolCalls}) => {
        if (toolCalls.length) {
            return;
        }
        for (const [k, v] of m) {
            if (content.startsWith(k) && v.startsWith(content)) {
                return {content: v, toolCalls: []};
            }
        }
    };
    f.add = async (content) => {
        const {truncated, tokenCount} = await tokenizer.truncate(correlationId, content, prefixTokenCount);
        if (tokenCount < prefixTokenCount) {
            return;
        }
        m.set(truncated, content);
    }
    return f;
};

const mapDropConflict = () => {
    const m = new Map();
    return {
        [Symbol.iterator]: function* () {
            for (const [k, v] of m) {
                const {c, v: v_} = v;
                if (c) {
                    continue;
                }
                yield [k, v_];
            }
        },
        set: (k, v) => {
            const prevV = m.get(k);
            if (!prevV) {
                m.set(k, {v});
                return;
            }
            const {c, v: v_} = prevV;
            if (c || v_ === v) {
                return;
            }
            m.set(k, {c: true});
        },
    };
};

const warnings = () => {
    const warnings = {normal: [], strong: []};
    const f = (message, extra = {}) => {
        log.log(message, extra);
        warnings.normal.push(message);
    };
    f.strong = (message, extra = {}) => {
        log.log(message, extra);
        warnings.strong.push(message);
    };
    f.merge = (other) => {
        warnings.normal.push(...other?.normal || []);
        warnings.strong.push(...other?.strong || []);
    };
    f.get = () => {
        const {normal, strong} = warnings;
        return !(normal.length || strong.length) ? null : {
            ...(!strong.length ? {} : {strong}),
            ...(!normal.length ? {} : {normal}),
        };
    };
    return f;
};

export default {
    DOC_ID,
    KIND_FIELD,
    RECURSED_NOTE_FIELD,
    RECURSED_QUERY_FIELD,
    QUERY_FIELD,
    QUERY_EMBEDDING_FIELD,
    REPLY_FIELD,
    REPLY_EMBEDDING_FIELD,
    SUMMARY_FIELD,
    SUMMARY_EMBEDDING_FIELD,
    INTROSPECTION_FIELD,
    INTROSPECTION_EMBEDDING_FIELD,
    IMAGINATION_FIELD,
    IMAGINATION_EMBEDDING_FIELD,
    MODEL_PROMPT_CORE_MSG,
    MODEL_PROMPT_EXTERNAL_COMPONENT_MSG,
    MODEL_PROMPT_INTERNAL_COMPONENT_MSG,
    MODEL_PROMPT_FORMATTED_TIME,
    CHAT_COST,
    absCosineSimilarity,
    embedWithRetry,
    chatWithRetry,
    wolframAlphaQueryWithRetry,
    serpSearchWithRetry,
    scraperExtractWithRetry,
    shortCircuitAutocompleteContentHook,
    warnings,
};
