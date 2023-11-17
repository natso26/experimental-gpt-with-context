import * as uuid from 'uuid';
import tokenizer from '../repository/tokenizer.js';
import memory from '../repository/memory.js';
import common from './common.js';
import fetch_ from '../util/fetch.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const MODEL_PROMPT_SCORE_FIELD = 'score';
const MODEL_PROMPT_QUERY_FIELD = 'query';
const MODEL_PROMPT_REPLY_FIELD = 'reply';
const MODEL_PROMPT_SUMMARY_FIELD = 'summary';
const MODEL_PROMPT_INTROSPECTION_FIELD = 'introspection';
const MODEL_PROMPT_IMAGINATION_FIELD = 'imagination';
const MODEL_PROMPT = (subroutineResults, longTermContext, shortTermContext, query) =>
    `You are GPT. This is an external system.\n`
    + (!subroutineResults.length ? '' : `internal subroutines: ${JSON.stringify(subroutineResults)}\n`)
    + `long-term memory: ${JSON.stringify(longTermContext)}\n`
    + `short-term memory: ${JSON.stringify(shortTermContext)}\n`
    + `user: ${JSON.stringify(query)}`;
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
const QUERY_TOKEN_COUNT_LIMIT = parseInt(process.env.CHAT_QUERY_TOKEN_COUNT_LIMIT);
const CTX_SCORE_FIRST_ITEMS_COUNT = parseInt(process.env.CHAT_CTX_SCORE_FIRST_ITEMS_COUNT);
const CTX_SCORE_FIRST_ITEMS_MAX_VAL = parseFloat(process.env.CHAT_CTX_SCORE_FIRST_ITEMS_MAX_VAL);
const CTX_SCORE_FIRST_ITEMS_LINEAR_DECAY = parseFloat(process.env.CHAT_CTX_SCORE_FIRST_ITEMS_LINEAR_DECAY);
const CTX_SCORE_REST_ITEMS_MULT_FACTOR = parseFloat(process.env.CHAT_CTX_SCORE_REST_ITEMS_MULT_FACTOR);
const CTX_SCORE_REST_ITEMS_IDX_OFFSET = parseFloat(process.env.CHAT_CTX_SCORE_REST_ITEMS_IDX_OFFSET);
const CTX_SCORE_REST_ITEMS_IDX_DECAY_EXPONENT = parseFloat(process.env.CHAT_CTX_SCORE_REST_ITEMS_IDX_DECAY_EXPONENT);
const CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MULT_FACTOR = parseFloat(process.env.CHAT_CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MULT_FACTOR);
const CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MS_VAL = parseFloat(process.env.CHAT_CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_HOUR_VAL) / (3600 * 1000);
const CTX_SCORE = (i, ms, getSim) => {
    if (i < CTX_SCORE_FIRST_ITEMS_COUNT) {
        return CTX_SCORE_FIRST_ITEMS_MAX_VAL - CTX_SCORE_FIRST_ITEMS_LINEAR_DECAY * i;
    }
    const idxTimePenalty = CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MULT_FACTOR * Math.log(CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MS_VAL * ms + 1);
    return CTX_SCORE_REST_ITEMS_MULT_FACTOR * (i + CTX_SCORE_REST_ITEMS_IDX_OFFSET + idxTimePenalty) ** -CTX_SCORE_REST_ITEMS_IDX_DECAY_EXPONENT * getSim();
};
const SHORT_TERM_CONTEXT_COUNT = parseInt(process.env.CHAT_SHORT_TERM_CONTEXT_COUNT);
const LONG_TERM_CONTEXT_COUNT = parseInt(process.env.CHAT_LONG_TERM_CONTEXT_COUNT);
const REPLY_TOKEN_COUNT_LIMIT = parseInt(process.env.CHAT_REPLY_TOKEN_COUNT_LIMIT);
const CHAT_RECURSION_TIMEOUT = parseInt(process.env.CHAT_RECURSION_TIMEOUT_SECS) * 1000;
const MIN_SCHEDULED_IMAGINATION_DELAY = parseInt(process.env.CHAT_MIN_SCHEDULED_IMAGINATION_DELAY_MINUTES) * 60 * 1000;
const MAX_SCHEDULED_IMAGINATION_DELAY = parseInt(process.env.CHAT_MAX_SCHEDULED_IMAGINATION_DELAY_MINUTES) * 60 * 1000;

const chat = wrapper.logCorrelationId('service.chat.chat', async (correlationId, chatId, query, isSubroutine) => {
    log.log('chat service parameters', {correlationId, chatId, query, isSubroutine});
    const startTime = new Date();
    const queryTokenCount = await tokenizer.countTokens(correlationId, query);
    log.log('chat query token count', {correlationId, chatId, queryTokenCount});
    if (queryTokenCount > QUERY_TOKEN_COUNT_LIMIT) {
        throw new Error(`chat query token count exceeds limit of ${QUERY_TOKEN_COUNT_LIMIT}: ${queryTokenCount}`);
    }
    const {embedding: queryEmbedding} = await common.embedWithRetry(correlationId, query);
    const rawShortTermContext = await memory.shortTermSearch(correlationId, chatId, (elt, i, timestamp) => {
        const ms = startTime - timestamp;
        const getSim = () => {
            const targetEmbedding = elt[common.QUERY_EMBEDDING_FIELD] || elt[common.INTROSPECTION_EMBEDDING_FIELD];
            return common.cosineSimilarity(queryEmbedding, targetEmbedding);
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
    const prelimPrompt = MODEL_PROMPT([], longTermContext, shortTermContext, query);
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
        for (const {name, args} of functionCalls) {
            switch (name) {
                case MODEL_RECURSION_FUNCTION_NAME:
                    const {query: recursedQuery} = args;
                    if (!recursedQuery) {
                        log.log(`chat: function call: ${MODEL_RECURSION_FUNCTION_NAME}: query is required`,
                            {correlationId, chatId, name, args});
                        continue;
                    }
                    if (recursedQuery === query) {
                        log.log(`chat: function call: ${MODEL_RECURSION_FUNCTION_NAME}: query is the same`,
                            {correlationId, chatId, name, args});
                        continue;
                    }
                    const recursedCorrelationId = uuid.v4();
                    log.log(`chat: function call: ${MODEL_RECURSION_FUNCTION_NAME}: recursed correlation id`,
                        {correlationId, chatId, name, recursedQuery, recursedCorrelationId});
                    try {
                        const res = await fetch_.withTimeout(`${process.env.BACKGROUND_TASK_HOST}/api/chat`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Correlation-Id': recursedCorrelationId,
                            },
                            body: JSON.stringify({chatId, query: recursedQuery, isSubroutine: true}),
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
                        functionResults.push(functionResult);
                    } catch (e) {
                        log.log(`chat: function call: ${MODEL_RECURSION_FUNCTION_NAME}: failed`, {
                            correlationId, chatId, name, recursedQuery, recursedCorrelationId,
                            error: e.message || '', stack: e.stack || '',
                        });
                    }
                    break;
                default:
                    log.log(`chat: unknown function call: ${name}`, {correlationId, chatId, name, args});
            }
        }
        endFunctionCallsTime = new Date();
        if (!functionResults.length) {
            log.log('chat: function call: no viable result; no special action needed',
                {correlationId, chatId});
        }
        const subroutineResults = functionResults.map(({query, reply}) => ({
            [MODEL_PROMPT_QUERY_FIELD]: query,
            [MODEL_PROMPT_REPLY_FIELD]: reply,
        }));
        updatedPrompt = MODEL_PROMPT(subroutineResults, longTermContext, shortTermContext, query);
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
    const replyTokenCount = await tokenizer.countTokens(correlationId, reply);
    const endTime = new Date();
    const extra = {
        correlationId,
        shortTermContext,
        longTermContext,
        prelimPrompt,
        functionCalls,
        functionResults,
        updatedPrompt,
        tokenCounts: {
            query: queryTokenCount,
            prelimPrompt: prelimPromptTokenCount,
            updatedPrompt: updatedPromptTokenCount,
            reply: replyTokenCount,
        },
        timeStats: {
            elapsed: endTime - startTime,
            elapsedPrelimChat: endPrelimChatTime - startPrelimChatTime,
            elapsedFunctionCalls: endFunctionCallsTime - startFunctionCallsTime,
            elapsedUpdatedChat: endUpdatedChatTime - startUpdatedChatTime,
            startTime,
            startPrelimChatTime,
            endPrelimChatTime,
            startFunctionCallsTime,
            endFunctionCallsTime,
            startUpdatedChatTime,
            endUpdatedChatTime,
            endTime,
        },
    };
    if (isSubroutine) {
        return {
            reply,
            ...extra,
        };
    }
    const {index, timestamp} = await memory.add(correlationId, chatId, {
        [common.QUERY_FIELD]: query,
        [common.QUERY_EMBEDDING_FIELD]: queryEmbedding,
        [common.REPLY_FIELD]: reply,
    }, extra, false);
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
