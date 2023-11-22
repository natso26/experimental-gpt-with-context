import * as uuid from 'uuid';
import tokenizer from '../repository/tokenizer.js';
import memory from '../repository/memory.js';
import common from './common.js';
import common_ from '../common.js';
import fetch_ from '../util/fetch.js';
import strictParse from '../util/strictParse.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';
import time from '../util/time.js';

const QUERY_INTERNAL_URL = `${process.env.INTERNAL_API_HOST}${common_.QUERY_INTERNAL_ROUTE}`;
const CONSOLIDATE_INTERNAL_URL = `${process.env.INTERNAL_API_HOST}${common_.CONSOLIDATE_INTERNAL_ROUTE}`;
const INTROSPECT_INTERNAL_URL = `${process.env.INTERNAL_API_HOST}${common_.INTROSPECT_INTERNAL_ROUTE}`;
const MODEL_PROMPT_SCORE_FIELD = 'score';
const MODEL_PROMPT_QUERY_FIELD = 'query';
const MODEL_PROMPT_REPLY_FIELD = 'reply';
const MODEL_PROMPT_SUMMARY_FIELD = 'summary';
const MODEL_PROMPT_INTROSPECTION_FIELD = 'introspection';
const MODEL_PROMPT_IMAGINATION_FIELD = 'imagination';
const MODEL_PROMPT = (info, search, subroutineHistory, subroutineResults, longTermContext, shortTermContext, query, subroutineQuery) =>
    (!subroutineQuery ? common.MODEL_PROMPT_EXTERNAL_COMPONENT_MSG : common.MODEL_PROMPT_INTERMEDIATE_COMPONENT_MSG)
    + (!info ? '' : `\ninternal information component: ${info}`)
    + (!search ? '' : `\ninternal search component: ${search}`)
    + `\ninternal subroutine history: ${JSON.stringify(subroutineHistory)}`
    + (!subroutineResults.length ? '' : `\ninternal subroutines: ${JSON.stringify(subroutineResults)}`)
    + `\nlong-term context: ${JSON.stringify(longTermContext)}`
    + `\nshort-term context: ${JSON.stringify(shortTermContext)}`
    + `\nquery: ${JSON.stringify(query)}`
    // NB: it is better to not duplicate in special case of recursing to same query
    + ((!subroutineQuery || subroutineQuery === query) ? '' : `\ninternal subroutine query: ${JSON.stringify(subroutineQuery)}`);
const MODEL_RECURSION_FUNCTION_NAME = 'thoughts';
const MODEL_RECURSION_FUNCTION_ARG_NAME = 'recursedQuery';
const MODEL_FUNCTIONS = [
    {
        name: MODEL_RECURSION_FUNCTION_NAME,
        description: '',
        parameters: {
            type: 'object',
            properties: {[MODEL_RECURSION_FUNCTION_ARG_NAME]: {type: 'string'}},
            required: [MODEL_RECURSION_FUNCTION_ARG_NAME],
        },
    },
];
const QUERY_TOKEN_COUNT_LIMIT = strictParse.int(process.env.QUERY_QUERY_TOKEN_COUNT_LIMIT);
const SUBROUTINE_QUERY_TOKEN_COUNT_LIMIT = strictParse.int(process.env.QUERY_SUBROUTINE_QUERY_TOKEN_COUNT_LIMIT);
const INFO_TRUNCATION_TOKEN_COUNT = strictParse.int(process.env.QUERY_INFO_TRUNCATION_TOKEN_COUNT);
const SEARCH_TRUNCATION_TOKEN_COUNT = strictParse.int(process.env.QUERY_SEARCH_TRUNCATION_TOKEN_COUNT);
const SUBROUTINE_HISTORY_COUNT = strictParse.int(process.env.QUERY_SUBROUTINE_HISTORY_COUNT);
const CTX_SCORE_FIRST_ITEMS_COUNT = strictParse.int(process.env.QUERY_CTX_SCORE_FIRST_ITEMS_COUNT);
const CTX_SCORE_FIRST_ITEMS_MAX_VAL = strictParse.float(process.env.QUERY_CTX_SCORE_FIRST_ITEMS_MAX_VAL);
const CTX_SCORE_FIRST_ITEMS_LINEAR_DECAY = strictParse.float(process.env.QUERY_CTX_SCORE_FIRST_ITEMS_LINEAR_DECAY);
const CTX_SCORE_REST_ITEMS_MULT_FACTOR = strictParse.float(process.env.QUERY_CTX_SCORE_REST_ITEMS_MULT_FACTOR);
const CTX_SCORE_REST_ITEMS_IDX_OFFSET = strictParse.float(process.env.QUERY_CTX_SCORE_REST_ITEMS_IDX_OFFSET);
const CTX_SCORE_REST_ITEMS_IDX_DECAY_EXPONENT = strictParse.float(process.env.QUERY_CTX_SCORE_REST_ITEMS_IDX_DECAY_EXPONENT);
const CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MULT_FACTOR = strictParse.float(process.env.QUERY_CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MULT_FACTOR);
const CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MS_VAL = strictParse.float(process.env.QUERY_CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_HOUR_VAL) / (3600 * 1000);
const CTX_SCORE = (i, ms, getSim) => {
    if (i < CTX_SCORE_FIRST_ITEMS_COUNT) {
        return CTX_SCORE_FIRST_ITEMS_MAX_VAL - CTX_SCORE_FIRST_ITEMS_LINEAR_DECAY * i;
    }
    const idxTimePenalty = CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MULT_FACTOR * Math.log(CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MS_VAL * ms + 1);
    return CTX_SCORE_REST_ITEMS_MULT_FACTOR * (i + CTX_SCORE_REST_ITEMS_IDX_OFFSET + idxTimePenalty) ** -CTX_SCORE_REST_ITEMS_IDX_DECAY_EXPONENT * getSim();
};
const SHORT_TERM_CONTEXT_COUNT = strictParse.int(process.env.QUERY_SHORT_TERM_CONTEXT_COUNT);
const LONG_TERM_CONTEXT_COUNT = strictParse.int(process.env.QUERY_LONG_TERM_CONTEXT_COUNT);
const REPLY_TOKEN_COUNT_LIMIT = strictParse.int(process.env.QUERY_REPLY_TOKEN_COUNT_LIMIT);
const RECURSION_TIMEOUT = strictParse.int(process.env.QUERY_RECURSION_TIMEOUT_SECS) * 1000;
const MIN_SCHEDULED_IMAGINATION_DELAY = strictParse.int(process.env.QUERY_MIN_SCHEDULED_IMAGINATION_DELAY_MINUTES) * 60 * 1000;
const MAX_SCHEDULED_IMAGINATION_DELAY = strictParse.int(process.env.QUERY_MAX_SCHEDULED_IMAGINATION_DELAY_MINUTES) * 60 * 1000;

const query = wrapper.logCorrelationId('service.query.query', async (correlationId, userId, sessionId, query, subroutineQuery, forbiddenRecursedQueries) => {
    log.log('query: parameters', {correlationId, userId, sessionId, query, subroutineQuery, forbiddenRecursedQueries});
    const docId = common.DOC_ID.from(userId, sessionId);
    const start = new Date();
    const {queryTokenCount, subroutineQueryTokenCount} =
        await getQueryTokenCounts(correlationId, docId, query, subroutineQuery);
    const [
        {info, infoTokenCount},
        {search, searchTokenCount},
        {subroutineHistory},
        {queryEmbedding, shortTermContext, longTermContext},
    ] = await Promise.all([
        getInfo(correlationId, docId, query, subroutineQuery),
        getSearch(correlationId, docId, query, subroutineQuery),
        getSubroutineHistory(correlationId, docId),
        (async () => {
            const {embedding: queryEmbedding} = await common.embedWithRetry(correlationId, query);
            const [
                {shortTermContext},
                {longTermContext},
            ] = await Promise.all([
                getShortTermContext(correlationId, docId, start, queryEmbedding),
                getLongTermContext(correlationId, docId, queryEmbedding),
            ]);
            return {queryEmbedding, shortTermContext, longTermContext};
        })(),
    ]);
    const prelimPrompt = MODEL_PROMPT(
        info, search, subroutineHistory, [], longTermContext, shortTermContext, query, subroutineQuery);
    log.log('query: prelim prompt', {correlationId, docId, prelimPrompt});
    const startPrelimChat = new Date();
    const {content: prelimReply, functionCalls: rawFunctionCalls} = await common.chatWithRetry(
        correlationId, prelimPrompt, REPLY_TOKEN_COUNT_LIMIT, MODEL_FUNCTIONS);
    const functionCalls = rawFunctionCalls || [];
    const elapsedPrelimChat = time.elapsedSecs(startPrelimChat);
    let functionResults = [];
    let elapsedFunctionCalls = 0;
    let updatedPrompt = '';
    let updatedReply = '';
    let elapsedUpdatedChat = 0;
    let updatedPromptTokenCount = 0;
    if (!prelimReply) {
        log.log('query: function call: function calls', {correlationId, docId, functionCalls});
        const startFunctionCalls = new Date();
        // NB: GPT likes to recurse with same query, or one of its siblings (a -> [b, c]; b -> c; c -> b).
        //  We do allow recursing to a sibling, but to prevent infinite recursion, we forbid repeating an ancestor.
        //  Except top-level query is allowed to immediately repeat to leverage more data.
        const updatedForbiddenRecursedQueries = [...new Set([
            ...forbiddenRecursedQueries, ...(!subroutineQuery ? [] : [query, subroutineQuery]),
        ])];
        const functionTasks = [];
        for (const {name, args} of functionCalls) {
            switch (name) {
                case MODEL_RECURSION_FUNCTION_NAME:
                    const {[MODEL_RECURSION_FUNCTION_ARG_NAME]: recursedQuery} = args;
                    if (!recursedQuery) {
                        log.log(`query: function call: ${name}: recursedQuery is required`,
                            {correlationId, docId, name, args});
                        continue;
                    }
                    if (updatedForbiddenRecursedQueries.includes(recursedQuery)) {
                        log.log(`query: function call: ${name}: recursedQuery is forbidden`,
                            {correlationId, docId, name, args, recursedQuery, updatedForbiddenRecursedQueries});
                        continue;
                    }
                    const recursedCorrelationId = uuid.v4();
                    log.log(`query: function call: ${name}: recursed correlation id`,
                        {correlationId, docId, name, recursedQuery, recursedCorrelationId});
                    const functionTask =
                        getRecursionRes(correlationId, docId, query, recursedCorrelationId, recursedQuery, updatedForbiddenRecursedQueries);
                    functionTasks.push(functionTask);
                    break;
                default:
                    log.log(`query: function call: unknown function: ${name}`, {correlationId, docId, name, args});
            }
        }
        functionResults = (await Promise.all(functionTasks))
            .map(({recursionRes}) => recursionRes).filter((v) => v);
        elapsedFunctionCalls = time.elapsedSecs(startFunctionCalls);
        if (!functionResults.length) {
            log.log('query: function call: no viable result; no special action needed',
                {correlationId, docId});
        }
        const subroutineResults = functionResults.map(({query, reply}) => ({
            [MODEL_PROMPT_QUERY_FIELD]: query,
            [MODEL_PROMPT_REPLY_FIELD]: reply,
        }));
        updatedPrompt = MODEL_PROMPT(
            info, search, subroutineHistory, subroutineResults, longTermContext, shortTermContext, query, subroutineQuery);
        log.log('query: updated prompt', {correlationId, docId, updatedPrompt});
        const startUpdatedChat = new Date();
        const {content: updatedReply_} = await common.chatWithRetry(
            correlationId, updatedPrompt, REPLY_TOKEN_COUNT_LIMIT, []);
        updatedReply = updatedReply_;
        elapsedUpdatedChat = time.elapsedSecs(startUpdatedChat);
        updatedPromptTokenCount = await tokenizer.countTokens(correlationId, updatedPrompt);
    }
    const prelimPromptTokenCount = await tokenizer.countTokens(correlationId, prelimPrompt);
    const reply = prelimReply || updatedReply;
    const replyTokenCount = await tokenizer.countTokens(correlationId, reply);
    const elapsed = time.elapsedSecs(start);
    const extra = {
        correlationId,
        info,
        search,
        subroutineHistory,
        shortTermContext,
        longTermContext,
        functionCalls,
        functionResults,
        tokenCounts: {
            query: queryTokenCount,
            subroutineQuery: subroutineQueryTokenCount,
            info: infoTokenCount,
            search: searchTokenCount,
            prelimPrompt: prelimPromptTokenCount,
            updatedPrompt: updatedPromptTokenCount,
            reply: replyTokenCount,
        },
        timeStats: {
            elapsed,
            elapsedPrelimChat,
            elapsedFunctionCalls,
            elapsedUpdatedChat,
        },
    };
    if (subroutineQuery) {
        return {
            reply,
            ...extra,
        };
    }
    const [
        ,
        {index, timestamp},
        {scheduledImagination},
    ] = await Promise.all([
        (async () => {
            for (const {query, reply} of functionResults) {
                await memory.addSubroutine(correlationId, docId, {
                    [common.QUERY_FIELD]: query,
                    [common.REPLY_FIELD]: reply,
                }, {correlationId});
            }
        })(),
        (async () => {
            const {embedding: replyEmbedding} = await common.embedWithRetry(correlationId, reply);
            const dbExtra = {
                ...extra,
                prelimPrompt,
                updatedPrompt,
            };
            return await memory.add(correlationId, docId, {
                [common.QUERY_FIELD]: query,
                [common.QUERY_EMBEDDING_FIELD]: queryEmbedding,
                [common.REPLY_FIELD]: reply,
                [common.REPLY_EMBEDDING_FIELD]: replyEmbedding,
            }, dbExtra, false);
        })(),
        setScheduledImagination(correlationId, docId),
    ]);
    triggerBackgroundTasks(correlationId, docId, index);
    return {
        index,
        timestamp,
        reply,
        ...extra,
        scheduledImagination,
    };
});

const getQueryTokenCounts = async (correlationId, docId, query, subroutineQuery) => {
    let queryTokenCount = 0;
    let subroutineQueryTokenCount = 0;
    if (!subroutineQuery) {
        queryTokenCount = await tokenizer.countTokens(correlationId, query);
        log.log('query: query token count', {correlationId, docId, queryTokenCount});
        if (queryTokenCount > QUERY_TOKEN_COUNT_LIMIT) {
            throw new Error(`query: query token count exceeds limit of ${QUERY_TOKEN_COUNT_LIMIT}: ${queryTokenCount}`);
        }
    } else {
        // assume query is already ok
        subroutineQueryTokenCount = await tokenizer.countTokens(correlationId, subroutineQuery);
        log.log('query: subroutine query token count', {correlationId, docId, subroutineQueryTokenCount});
        if (subroutineQueryTokenCount > SUBROUTINE_QUERY_TOKEN_COUNT_LIMIT) {
            throw new Error(`query: subroutine query token count exceeds limit of ${SUBROUTINE_QUERY_TOKEN_COUNT_LIMIT}: ${subroutineQueryTokenCount}`);
        }
    }
    return {queryTokenCount, subroutineQueryTokenCount};
};

const getInfo = async (correlationId, docId, query, subroutineQuery) => {
    let info = '';
    let infoTokenCount = 0;
    // NB: do not do at top level; it overly influences GPT
    if (subroutineQuery) {
        try {
            const {pods: rawInfo} = await common.wolframAlphaQueryWithRetry(correlationId, subroutineQuery);
            if (rawInfo.length) {
                const {truncated, tokenCount} = await tokenizer.truncate(
                    correlationId, JSON.stringify(rawInfo), INFO_TRUNCATION_TOKEN_COUNT);
                info = truncated;
                infoTokenCount = Math.min(tokenCount, INFO_TRUNCATION_TOKEN_COUNT);
            }
        } catch (e) {
            log.log('query: wolfram alpha query failed; continue since it is not critical',
                {correlationId, docId, query, subroutineQuery, error: e.message || '', stack: e.stack || ''});
        }
        log.log('query: info', {correlationId, docId, info, infoTokenCount});
    }
    return {info, infoTokenCount};
};

const getSearch = async (correlationId, docId, query, subroutineQuery) => {
    let search = '';
    let searchTokenCount = 0;
    // NB: do not do at top level; it overly influences GPT
    if (subroutineQuery) {
        try {
            const {data: rawSearch} = await common.serpSearchWithRetry(correlationId, subroutineQuery);
            if (rawSearch) {
                const {truncated, tokenCount} = await tokenizer.truncate(
                    correlationId, JSON.stringify(rawSearch), SEARCH_TRUNCATION_TOKEN_COUNT);
                search = truncated;
                searchTokenCount = Math.min(tokenCount, SEARCH_TRUNCATION_TOKEN_COUNT);
            }
        } catch (e) {
            log.log('query: serp search failed; continue since it is not critical',
                {correlationId, docId, query, subroutineQuery, error: e.message || '', stack: e.stack || ''});
        }
        log.log('query: search', {correlationId, docId, search, searchTokenCount});
    }
    return {search, searchTokenCount};
};

const getSubroutineHistory = async (correlationId, docId) => {
    const rawSubroutineHistory = await memory.getSubroutines(correlationId, docId, SUBROUTINE_HISTORY_COUNT);
    const subroutineHistory = rawSubroutineHistory.map(
        ({
             [common.QUERY_FIELD]: query,
             [common.REPLY_FIELD]: reply,
         }) => ({
            [MODEL_PROMPT_QUERY_FIELD]: query,
            [MODEL_PROMPT_REPLY_FIELD]: reply,
        }));
    return {subroutineHistory};
};

const getShortTermContext = async (correlationId, docId, start, queryEmbedding) => {
    const rawShortTermContext = await memory.shortTermSearch(correlationId, docId, (elt, i, timestamp) => {
        const ms = start - timestamp;
        const getSim = () => {
            const {
                [common.QUERY_EMBEDDING_FIELD]: targetQueryEmbedding,
                [common.REPLY_EMBEDDING_FIELD]: replyEmbedding,
                [common.INTROSPECTION_EMBEDDING_FIELD]: introspectionEmbedding,
            } = elt;
            if (introspectionEmbedding) {
                return common.cosineSimilarity(queryEmbedding, introspectionEmbedding);
            } else {
                return Math.sqrt(common.cosineSimilarity(queryEmbedding, targetQueryEmbedding)
                    * common.cosineSimilarity(queryEmbedding, replyEmbedding));
            }
        };
        return CTX_SCORE(i, ms, getSim);
    }, SHORT_TERM_CONTEXT_COUNT);
    const shortTermContext = rawShortTermContext.map(([{
        [common.QUERY_FIELD]: query,
        [common.REPLY_FIELD]: reply,
        [common.INTROSPECTION_FIELD]: introspection,
    }, rawScore]) => {
        const score = parseFloat(rawScore.toFixed(3));
        return !introspection ? {
            [MODEL_PROMPT_SCORE_FIELD]: score,
            [MODEL_PROMPT_QUERY_FIELD]: query,
            [MODEL_PROMPT_REPLY_FIELD]: reply,
        } : {
            [MODEL_PROMPT_SCORE_FIELD]: score,
            [MODEL_PROMPT_INTROSPECTION_FIELD]: introspection,
        };
    }).reverse();
    log.log('query: short-term context', {correlationId, docId, shortTermContext});
    return {shortTermContext};
};

const getLongTermContext = async (correlationId, docId, queryEmbedding) => {
    const rawLongTermContext = await memory.longTermSearch(correlationId, docId, (_, consolidation) => {
        const targetEmbedding = consolidation[common.SUMMARY_EMBEDDING_FIELD] || consolidation[common.IMAGINATION_EMBEDDING_FIELD];
        return common.cosineSimilarity(queryEmbedding, targetEmbedding);
    }, LONG_TERM_CONTEXT_COUNT);
    const longTermContext = rawLongTermContext.map(([{
        [common.SUMMARY_FIELD]: summary,
        [common.IMAGINATION_FIELD]: imagination,
    },]) =>
        !imagination ? {
            [MODEL_PROMPT_SUMMARY_FIELD]: summary,
        } : {
            [MODEL_PROMPT_IMAGINATION_FIELD]: imagination,
        }).reverse();
    log.log('query: long-term context', {correlationId, docId, longTermContext});
    return {longTermContext};
};

const getRecursionRes = async (correlationId, docId, query, recursedCorrelationId, recursedQuery, updatedForbiddenRecursedQueries) => {
    const {userId, sessionId} = common.DOC_ID.parse(docId);
    try {
        const resp = await fetch_.withTimeout(QUERY_INTERNAL_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                [common_.CORRELATION_ID_HEADER]: recursedCorrelationId,
                [common_.INTERNAL_API_ACCESS_KEY_HEADER]: common_.SECRETS.INTERNAL_API_ACCESS_KEY,
            },
            body: JSON.stringify({
                userId, sessionId, query,
                subroutineQuery: recursedQuery, forbiddenRecursedQueries: updatedForbiddenRecursedQueries,
            }),
        }, RECURSION_TIMEOUT);
        if (!resp.ok) {
            throw new Error(`query: recursion: api error, status: ${resp.status}`);
        }
        const data = await resp.json();
        const recursionRes = {
            query: recursedQuery,
            ...data,
        };
        log.log(`query: recursion: result`,
            {correlationId, docId, recursedQuery, recursedCorrelationId});
        return {recursionRes};
    } catch (e) {
        log.log(`query: recursion: failed`, {
            correlationId, docId, recursedQuery, recursedCorrelationId,
            error: e.message || '', stack: e.stack || '',
        });
        return {recursionRes: null};
    }
};

const setScheduledImagination = async (correlationId, docId) => {
    return await memory.scheduleImagination(correlationId, docId, (curr) => {
        if (curr) {
            return curr;
        }
        const scheduledImagination = new Date(
            new Date().getTime() + MIN_SCHEDULED_IMAGINATION_DELAY
            + Math.random() * (MAX_SCHEDULED_IMAGINATION_DELAY - MIN_SCHEDULED_IMAGINATION_DELAY));
        log.log('query: scheduled imagination', {correlationId, docId, scheduledImagination});
        return scheduledImagination;
    }).catch((e) => {
        log.log('query: schedule imagination failed; continue since it is of low priority', {
            correlationId, docId, error: e.message || '', stack: e.stack || '',
        });
        return null;
    });
};

const triggerBackgroundTasks = (correlationId, docId, index) => {
    const {userId, sessionId} = common.DOC_ID.parse(docId);
    fetch_.withTimeout(CONSOLIDATE_INTERNAL_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            [common_.CORRELATION_ID_HEADER]: correlationId,
            [common_.INTERNAL_API_ACCESS_KEY_HEADER]: common_.SECRETS.INTERNAL_API_ACCESS_KEY,
        },
        body: JSON.stringify({userId, sessionId}),
    }, 60 * 1000).catch((e) =>
        log.log(`query: fetch ${common_.CONSOLIDATE_INTERNAL_ROUTE} failed, likely timed out`, {
            correlationId, docId, error: e.message || '', stack: e.stack || '',
        }));
    fetch_.withTimeout(INTROSPECT_INTERNAL_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            [common_.CORRELATION_ID_HEADER]: correlationId,
            [common_.INTERNAL_API_ACCESS_KEY_HEADER]: common_.SECRETS.INTERNAL_API_ACCESS_KEY,
        },
        body: JSON.stringify({userId, sessionId, index}),
    }, 60 * 1000).catch((e) =>
        log.log(`query: fetch ${common_.INTROSPECT_INTERNAL_ROUTE} failed, likely timed out`, {
            correlationId, docId, error: e.message || '', stack: e.stack || '',
        }));
};

export default {
    query,
};
