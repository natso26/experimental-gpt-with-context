import * as uuid from 'uuid';
import tokenizer from '../repository/tokenizer.js';
import memory from '../repository/memory.js';
import common from './common.js';
import fetch_ from '../util/fetch.js';
import strictParse from '../util/strictParse.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const MODEL_PROMPT_SCORE_FIELD = 'score';
const MODEL_PROMPT_QUERY_FIELD = 'query';
const MODEL_PROMPT_REPLY_FIELD = 'reply';
const MODEL_PROMPT_SUMMARY_FIELD = 'summary';
const MODEL_PROMPT_INTROSPECTION_FIELD = 'introspection';
const MODEL_PROMPT_IMAGINATION_FIELD = 'imagination';
const MODEL_PROMPT = (info, subroutineHistory, subroutineResults, longTermContext, shortTermContext, query, subroutineQuery) =>
    `You are GPT. This is an external system.`
    + (!info.length ? '' : `\ninternal automated system: ${JSON.stringify(info)}`)
    + `\ninternal subroutine history: ${JSON.stringify(subroutineHistory)}`
    + (!subroutineResults.length ? '' : `\ninternal subroutines: ${JSON.stringify(subroutineResults)}`)
    + `\nlong-term memory: ${JSON.stringify(longTermContext)}`
    + `\nshort-term memory: ${JSON.stringify(shortTermContext)}`
    + `\nquery: ${JSON.stringify(query)}`
    + (!subroutineQuery ? '' : `\ninternal subroutine query: ${JSON.stringify(subroutineQuery)}`);
const MODEL_RECURSION_FUNCTION_NAME = 'thoughts';
const MODEL_RECURSION_FUNCTION_ARG_NAME = 'query';
const MODEL_FUNCTIONS = [
    {
        name: MODEL_RECURSION_FUNCTION_NAME,
        description: '',
        parameters: {
            type: 'object',
            properties: {
                [MODEL_RECURSION_FUNCTION_ARG_NAME]: {
                    type: 'string',
                },
            },
            required: [
                MODEL_RECURSION_FUNCTION_ARG_NAME,
            ],
        },
    },
];
const QUERY_TOKEN_COUNT_LIMIT = strictParse.int(process.env.CHAT_QUERY_TOKEN_COUNT_LIMIT);
const SUBROUTINE_HISTORY_COUNT = strictParse.int(process.env.CHAT_SUBROUTINE_HISTORY_COUNT);
const CTX_SCORE_FIRST_ITEMS_COUNT = strictParse.int(process.env.CHAT_CTX_SCORE_FIRST_ITEMS_COUNT);
const CTX_SCORE_FIRST_ITEMS_MAX_VAL = strictParse.float(process.env.CHAT_CTX_SCORE_FIRST_ITEMS_MAX_VAL);
const CTX_SCORE_FIRST_ITEMS_LINEAR_DECAY = strictParse.float(process.env.CHAT_CTX_SCORE_FIRST_ITEMS_LINEAR_DECAY);
const CTX_SCORE_REST_ITEMS_MULT_FACTOR = strictParse.float(process.env.CHAT_CTX_SCORE_REST_ITEMS_MULT_FACTOR);
const CTX_SCORE_REST_ITEMS_IDX_OFFSET = strictParse.float(process.env.CHAT_CTX_SCORE_REST_ITEMS_IDX_OFFSET);
const CTX_SCORE_REST_ITEMS_IDX_DECAY_EXPONENT = strictParse.float(process.env.CHAT_CTX_SCORE_REST_ITEMS_IDX_DECAY_EXPONENT);
const CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MULT_FACTOR = strictParse.float(process.env.CHAT_CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MULT_FACTOR);
const CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MS_VAL = strictParse.float(process.env.CHAT_CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_HOUR_VAL) / (3600 * 1000);
const CTX_SCORE = (i, ms, getSim) => {
    if (i < CTX_SCORE_FIRST_ITEMS_COUNT) {
        return CTX_SCORE_FIRST_ITEMS_MAX_VAL - CTX_SCORE_FIRST_ITEMS_LINEAR_DECAY * i;
    }
    const idxTimePenalty = CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MULT_FACTOR * Math.log(CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MS_VAL * ms + 1);
    return CTX_SCORE_REST_ITEMS_MULT_FACTOR * (i + CTX_SCORE_REST_ITEMS_IDX_OFFSET + idxTimePenalty) ** -CTX_SCORE_REST_ITEMS_IDX_DECAY_EXPONENT * getSim();
};
const SHORT_TERM_CONTEXT_COUNT = strictParse.int(process.env.CHAT_SHORT_TERM_CONTEXT_COUNT);
const LONG_TERM_CONTEXT_COUNT = strictParse.int(process.env.CHAT_LONG_TERM_CONTEXT_COUNT);
const REPLY_TOKEN_COUNT_LIMIT = strictParse.int(process.env.CHAT_REPLY_TOKEN_COUNT_LIMIT);
const CHAT_RECURSION_TIMEOUT = strictParse.int(process.env.CHAT_RECURSION_TIMEOUT_SECS) * 1000;
const MIN_SCHEDULED_IMAGINATION_DELAY = strictParse.int(process.env.CHAT_MIN_SCHEDULED_IMAGINATION_DELAY_MINUTES) * 60 * 1000;
const MAX_SCHEDULED_IMAGINATION_DELAY = strictParse.int(process.env.CHAT_MAX_SCHEDULED_IMAGINATION_DELAY_MINUTES) * 60 * 1000;

const chat = wrapper.logCorrelationId('service.chat.chat', async (correlationId, chatId, query, subroutineQuery, forbiddenRecursedQueries) => {
    log.log('chat service parameters', {correlationId, chatId, query, subroutineQuery, forbiddenRecursedQueries});
    const startTime = new Date();
    const queryTokenCount = await tokenizer.countTokens(correlationId, query);
    log.log('chat query token count', {correlationId, chatId, queryTokenCount});
    if (queryTokenCount > QUERY_TOKEN_COUNT_LIMIT) {
        throw new Error(`chat query token count exceeds limit of ${QUERY_TOKEN_COUNT_LIMIT}: ${queryTokenCount}`);
    }
    let info = [];
    // NB: avoid wolfram alpha at top level; it overly influences GPT
    if (subroutineQuery) {
        try {
            const {pods: info_} = await common.wolframAlphaQueryWithRetry(correlationId, subroutineQuery);
            info = info_;
        } catch (e) {
            log.log('chat wolfram alpha query failed; continue since it is not critical',
                {correlationId, chatId, query, subroutineQuery, error: e.message || '', stack: e.stack || ''});
        }
    }
    log.log('chat info', {correlationId, chatId, info});
    const rawSubroutineHistory = await memory.getSubroutines(correlationId, chatId, SUBROUTINE_HISTORY_COUNT);
    const subroutineHistory = rawSubroutineHistory.map(
        ({
             [common.QUERY_FIELD]: query,
             [common.REPLY_FIELD]: reply,
         }) => ({
            [MODEL_PROMPT_QUERY_FIELD]: query,
            [MODEL_PROMPT_REPLY_FIELD]: reply,
        }));
    const {embedding: queryEmbedding} = await common.embedWithRetry(correlationId, query);
    const rawShortTermContext = await memory.shortTermSearch(correlationId, chatId, (elt, i, timestamp) => {
        const ms = startTime - timestamp;
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
    log.log('chat short-term context', {correlationId, chatId, shortTermContext});
    const rawLongTermContext = await memory.longTermSearch(correlationId, chatId, (_, consolidation) => {
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
    log.log('chat long-term context', {correlationId, chatId, longTermContext});
    const prelimPrompt = MODEL_PROMPT(
        info, subroutineHistory, [], longTermContext, shortTermContext, query, subroutineQuery);
    log.log('chat prelim prompt', {correlationId, chatId, prelimPrompt});
    const startPrelimChatTime = new Date();
    const {content: prelimReply, functionCalls: rawFunctionCalls} = await common.chatWithRetry(
        correlationId, prelimPrompt, REPLY_TOKEN_COUNT_LIMIT, MODEL_FUNCTIONS);
    const endPrelimChatTime = new Date();
    const functionCalls = rawFunctionCalls || [];
    let startFunctionCallsTime = new Date(0);
    let endFunctionCallsTime = new Date(0);
    let functionResults = [];
    let updatedPrompt = '';
    let startUpdatedChatTime = new Date(0);
    let endUpdatedChatTime = new Date(0);
    let updatedReply = '';
    let updatedPromptTokenCount = 0;
    if (!prelimReply) {
        log.log('chat function calls', {correlationId, chatId, functionCalls});
        startFunctionCallsTime = new Date();
        // NB: GPT likes to recurse with same query, or one of its siblings (a -> [b, c]; b -> c; c -> b).
        //  We do allow recursing to a sibling, but to prevent infinite recursion, we forbid repeating an ancestor.
        //  Except top-level query is allowed to immediately repeat to leverage wolfram alpha.
        const updatedForbiddenRecursedQueries = [...new Set([
            ...forbiddenRecursedQueries, ...(!subroutineQuery ? [] : [query, subroutineQuery]),
        ])];
        const subtasks = [];
        for (const {name, args} of functionCalls) {
            switch (name) {
                case MODEL_RECURSION_FUNCTION_NAME:
                    const {query: recursedQuery} = args;
                    if (!recursedQuery) {
                        log.log(`chat: function call: ${MODEL_RECURSION_FUNCTION_NAME}: query is required`,
                            {correlationId, chatId, name, args});
                        continue;
                    }
                    if (updatedForbiddenRecursedQueries.includes(recursedQuery)) {
                        log.log(`chat: function call: ${MODEL_RECURSION_FUNCTION_NAME}: query is forbidden`,
                            {correlationId, chatId, name, args, recursedQuery, updatedForbiddenRecursedQueries});
                        continue;
                    }
                    log.log(`chat: function call: ${MODEL_RECURSION_FUNCTION_NAME}: query is allowed`,
                        {correlationId, chatId, name, args, recursedQuery, updatedForbiddenRecursedQueries});
                    const recursedCorrelationId = uuid.v4();
                    log.log(`chat: function call: ${MODEL_RECURSION_FUNCTION_NAME}: recursed correlation id`,
                        {correlationId, chatId, name, recursedQuery, recursedCorrelationId});
                    subtasks.push(async () => {
                        try {
                            const res = await fetch_.withTimeout(`${process.env.BACKGROUND_TASK_HOST}/api/chat`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'X-Correlation-Id': recursedCorrelationId,
                                },
                                body: JSON.stringify({
                                    chatId, query, subroutineQuery: recursedQuery,
                                    forbiddenRecursedQueries: updatedForbiddenRecursedQueries,
                                }),
                            }, CHAT_RECURSION_TIMEOUT);
                            if (!res.ok) {
                                throw new Error(`chat: function call: ${MODEL_RECURSION_FUNCTION_NAME}: api error, status: ${res.status}`);
                            }
                            const data = await res.json();
                            const functionResult = {
                                query: recursedQuery,
                                ...data,
                            };
                            log.log(`chat: function call: ${MODEL_RECURSION_FUNCTION_NAME}: result`, {
                                correlationId, chatId, name, recursedCorrelationId, functionResult,
                            });
                            return functionResult;
                        } catch (e) {
                            log.log(`chat: function call: ${MODEL_RECURSION_FUNCTION_NAME}: failed`, {
                                correlationId, chatId, name, recursedQuery, recursedCorrelationId,
                                error: e.message || '', stack: e.stack || '',
                            });
                            return null;
                        }
                    });
                    break;
                default:
                    log.log(`chat: unknown function call: ${name}`, {correlationId, chatId, name, args});
            }
        }
        functionResults = (await Promise.all(subtasks.map((f) => f())))
            .filter((v) => v);
        endFunctionCallsTime = new Date();
        if (!functionResults.length) {
            log.log('chat: function call: no viable result; no special action needed',
                {correlationId, chatId});
        }
        const subroutineResults = functionResults.map(({query, reply}) => ({
            [MODEL_PROMPT_QUERY_FIELD]: query,
            [MODEL_PROMPT_REPLY_FIELD]: reply,
        }));
        updatedPrompt = MODEL_PROMPT(
            info, subroutineHistory, subroutineResults, longTermContext, shortTermContext, query, subroutineQuery);
        log.log('chat updated prompt', {correlationId, chatId, updatedPrompt});
        startUpdatedChatTime = new Date();
        const {content: updatedReply_} = await common.chatWithRetry(
            correlationId, updatedPrompt, REPLY_TOKEN_COUNT_LIMIT, []);
        endUpdatedChatTime = new Date();
        updatedReply = updatedReply_;
        updatedPromptTokenCount = await tokenizer.countTokens(correlationId, updatedPrompt);
    }
    const prelimPromptTokenCount = await tokenizer.countTokens(correlationId, prelimPrompt);
    const reply = prelimReply || updatedReply;
    let replyEmbedding = null;
    if (!subroutineQuery) {
        const {embedding: replyEmbedding_} = await common.embedWithRetry(correlationId, reply);
        replyEmbedding = replyEmbedding_;
    }
    const replyTokenCount = await tokenizer.countTokens(correlationId, reply);
    if (!subroutineQuery) {
        for (const {query, reply} of functionResults) {
            await memory.addSubroutine(correlationId, chatId, {
                [common.QUERY_FIELD]: query,
                [common.REPLY_FIELD]: reply,
            }, {correlationId});
        }
    }
    const endTime = new Date();
    const extra = {
        correlationId,
        info: JSON.stringify(info), // info may have nested arrays which Firestore does not like
        subroutineHistory,
        shortTermContext,
        longTermContext,
        functionCalls,
        functionResults,
        tokenCounts: {
            query: queryTokenCount,
            prelimPrompt: prelimPromptTokenCount,
            updatedPrompt: updatedPromptTokenCount,
            reply: replyTokenCount,
        },
        timeStats: {
            elapsed: (endTime - startTime) / 1000,
            elapsedPrelimChat: (endPrelimChatTime - startPrelimChatTime) / 1000,
            elapsedFunctionCalls: (endFunctionCallsTime - startFunctionCallsTime) / 1000,
            elapsedUpdatedChat: (endUpdatedChatTime - startUpdatedChatTime) / 1000,
            endPrelimChatTime,
            endFunctionCallsTime,
            endUpdatedChatTime,
            endTime,
        },
    };
    if (subroutineQuery) {
        return {
            reply,
            ...extra,
        };
    }
    const dbExtra = {
        ...extra,
        prelimPrompt,
        updatedPrompt,
    };
    const {index, timestamp} = await memory.add(correlationId, chatId, {
        [common.QUERY_FIELD]: query,
        [common.QUERY_EMBEDDING_FIELD]: queryEmbedding,
        [common.REPLY_FIELD]: reply,
        [common.REPLY_EMBEDDING_FIELD]: replyEmbedding,
    }, dbExtra, false);
    // in background
    fetch_.withTimeout(`${process.env.BACKGROUND_TASK_HOST}/api/consolidate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Correlation-Id': correlationId,
        },
        body: JSON.stringify({chatId}),
    }, 60 * 1000).catch((e) =>
        log.log('chat: fetch /api/consolidate failed, likely timed out', {
            correlationId, chatId, error: e.message || '', stack: e.stack || '',
        }));
    // in background
    fetch_.withTimeout(`${process.env.BACKGROUND_TASK_HOST}/api/introspect`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Correlation-Id': correlationId,
        },
        body: JSON.stringify({chatId, index}),
    }, 60 * 1000).catch((e) =>
        log.log('chat: fetch /api/introspect failed, likely timed out', {
            correlationId, chatId, error: e.message || '', stack: e.stack || '',
        }));
    const scheduledImagination = await memory.scheduleImagination(correlationId, chatId, (curr) => {
        if (curr) {
            return curr;
        }
        const scheduledImagination = new Date(
            new Date().getTime() + MIN_SCHEDULED_IMAGINATION_DELAY
            + Math.random() * (MAX_SCHEDULED_IMAGINATION_DELAY - MIN_SCHEDULED_IMAGINATION_DELAY));
        log.log('chat scheduled imagination', {correlationId, chatId, scheduledImagination});
        return scheduledImagination;
    }).catch((e) => {
        log.log('chat: schedule imagination failed; continue since it is of low priority', {
            correlationId, chatId, error: e.message || '', stack: e.stack || '',
        });
        return null;
    });
    return {
        index,
        timestamp,
        reply,
        ...extra,
        scheduledImagination,
    };
});

export default {
    chat,
};
