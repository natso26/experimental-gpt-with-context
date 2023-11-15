import * as uuid from 'uuid';
import tokenizer from '../repository/tokenizer.js';
import memory from '../repository/memory.js';
import common from './common.js';
import fetch_ from '../util/fetch.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const QUESTION_TOKEN_COUNT_LIMIT = parseInt(process.env.CHAT_QUESTION_TOKEN_COUNT_LIMIT);
const SHORT_TERM_CONTEXT_COUNT = parseInt(process.env.CHAT_SHORT_TERM_CONTEXT_COUNT);
const LONG_TERM_CONTEXT_COUNT = parseInt(process.env.CHAT_LONG_TERM_CONTEXT_COUNT);
const REPLY_TOKEN_COUNT_LIMIT = parseInt(process.env.CHAT_REPLY_TOKEN_COUNT_LIMIT);
const CHAT_RECURSION_TIMEOUT = parseInt(process.env.CHAT_RECURSION_TIMEOUT_SECS) * 1000;
const MIN_SCHEDULED_IMAGINATION_DELAY = parseInt(process.env.CHAT_MIN_SCHEDULED_IMAGINATION_DELAY_MINUTES) * 60 * 1000;
const MAX_SCHEDULED_IMAGINATION_DELAY = parseInt(process.env.CHAT_MAX_SCHEDULED_IMAGINATION_DELAY_MINUTES) * 60 * 1000;

const chat = wrapper.logCorrelationId('service.chat.chat', async (correlationId, chatId, question, isSubroutine) => {
    log.log('chat service parameters', {correlationId, chatId, question, isSubroutine});
    const questionTokenCount = await tokenizer.countTokens(correlationId, question);
    log.log('chat question token count', {correlationId, chatId, questionTokenCount});
    if (questionTokenCount > QUESTION_TOKEN_COUNT_LIMIT) {
        throw new Error(`chat question token count exceeds limit of ${QUESTION_TOKEN_COUNT_LIMIT}: ${questionTokenCount}`);
    }
    const {embedding: questionEmbedding} = await common.embedWithRetry(correlationId, question);
    const refTime = new Date();
    const rawShortTermContext = await memory.shortTermSearch(correlationId, chatId, (elt, i, timestamp) => {
        const discount = recencyDiscount(i, refTime - timestamp);
        if (discount === null) {
            return 99 - i;
        }
        const targetEmbedding = elt[common.QUESTION_EMBEDDING_FIELD] || elt[common.INTROSPECTION_EMBEDDING_FIELD];
        return 10 * common.cosineSimilarity(questionEmbedding, targetEmbedding) * discount;
    }, SHORT_TERM_CONTEXT_COUNT);
    const shortTermContext = rawShortTermContext.map(([{
        [common.QUESTION_FIELD]: question,
        [common.REPLY_FIELD]: reply,
        [common.INTROSPECTION_FIELD]: introspection,
    }, rawRelevance]) => {
        const relevance = parseFloat(rawRelevance.toFixed(3));
        return !introspection ? {relevance, question, reply} : {relevance, introspection};
    }).reverse();
    log.log('chat short-term context', {correlationId, chatId, shortTermContext});
    const rawLongTermContext = await memory.longTermSearch(correlationId, chatId, (_, consolidation) => {
        const targetEmbedding = consolidation[common.SUMMARY_EMBEDDING_FIELD] || consolidation[common.IMAGINATION_EMBEDDING_FIELD];
        return common.cosineSimilarity(questionEmbedding, targetEmbedding);
    }, LONG_TERM_CONTEXT_COUNT);
    const longTermContext = rawLongTermContext.map(([{
        [common.SUMMARY_FIELD]: summary,
        [common.IMAGINATION_FIELD]: imagination,
    },]) =>
        !imagination ? {summary} : {imagination}).reverse();
    log.log('chat long-term context', {correlationId, chatId, longTermContext});
    const prelimPrompt = chatPrompt([], longTermContext, shortTermContext, question);
    log.log('chat prelim prompt', {correlationId, chatId, prelimPrompt});
    const {content: prelimReply, functionCalls: rawFunctionCalls} = await common.chatWithRetry(
        correlationId, prelimPrompt, REPLY_TOKEN_COUNT_LIMIT, chatFunctions);
    const functionCalls = rawFunctionCalls || [];
    let functionResults = [];
    let updatedPrompt = '';
    let updatedReply = '';
    let updatedPromptTokenCount = 0;
    if (!prelimReply) {
        log.log('chat function calls', {correlationId, chatId, functionCalls});
        for (const {name, args} of functionCalls) {
            switch (name) {
                case 'think':
                    const {question: recursedQuestion} = args;
                    if (!recursedQuestion) {
                        log.log('chat: function call: think: question is required',
                            {correlationId, chatId, name, args});
                        continue;
                    }
                    if (recursedQuestion === question) {
                        log.log('chat: function call: think: question is the same',
                            {correlationId, chatId, name, args});
                        continue;
                    }
                    const recursedCorrelationId = uuid.v4();
                    log.log('chat: function call: think: recursed correlation id',
                        {correlationId, chatId, name, recursedQuestion, recursedCorrelationId});
                    try {
                        const res = await fetch_.withTimeout(`${process.env.BACKGROUND_TASK_HOST}/api/chat`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Correlation-Id': recursedCorrelationId,
                            },
                            body: JSON.stringify({chatId, question: recursedQuestion, isSubroutine: true}),
                        }, CHAT_RECURSION_TIMEOUT);
                        if (!res.ok) {
                            throw new Error(`chat: function call: think: api error, status: ${res.status}`);
                        }
                        const data = await res.json();
                        const functionResult = {
                            question: recursedQuestion,
                            ...data,
                        };
                        log.log('chat: function call: think: result', {
                            correlationId, chatId, name, recursedCorrelationId, functionResult,
                        });
                        functionResults.push(functionResult);
                    } catch (e) {
                        log.log('chat: function call: think: failed', {
                            correlationId, chatId, name, recursedQuestion, recursedCorrelationId,
                            error: e.message || '', stack: e.stack || '',
                        });
                    }
                    break;
                default:
                    log.log(`chat: unknown function call: ${name}`, {correlationId, chatId, name, args});
            }
        }
        if (!functionResults.length) {
            log.log('chat: function call: no viable result; no special action needed',
                {correlationId, chatId});
        }
        const subroutineResults = functionResults.map(
            ({question, reply}) => ({question, reply}));
        updatedPrompt = chatPrompt(subroutineResults, longTermContext, shortTermContext, question);
        log.log('chat updated prompt', {correlationId, chatId, updatedPrompt});
        const {content: updatedReply_} = await common.chatWithRetry(
            correlationId, updatedPrompt, REPLY_TOKEN_COUNT_LIMIT, []);
        updatedReply = updatedReply_;
        updatedPromptTokenCount = await tokenizer.countTokens(correlationId, updatedPrompt);
    }
    const prelimPromptTokenCount = await tokenizer.countTokens(correlationId, prelimPrompt);
    const reply = prelimReply || updatedReply;
    const replyTokenCount = await tokenizer.countTokens(correlationId, reply);
    if (isSubroutine) {
        return {
            reply,
            questionTokenCount,
            shortTermContext,
            longTermContext,
            prelimPrompt,
            functionCalls,
            functionResults,
            updatedPrompt,
            updatedPromptTokenCount,
            prelimPromptTokenCount,
            replyTokenCount,
        };
    }
    const {index, timestamp} = await memory.add(correlationId, chatId, {
        [common.QUESTION_FIELD]: question,
        [common.QUESTION_EMBEDDING_FIELD]: questionEmbedding,
        [common.REPLY_FIELD]: reply,
    }, {
        questionTokenCount,
        shortTermContext,
        longTermContext,
        prelimPrompt,
        functionCalls,
        functionResults,
        updatedPrompt,
        updatedPromptTokenCount,
        prelimPromptTokenCount,
        replyTokenCount,
    }, false);
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
        questionTokenCount,
        shortTermContext,
        longTermContext,
        prelimPrompt,
        functionCalls,
        functionResults,
        updatedPrompt,
        updatedPromptTokenCount,
        prelimPromptTokenCount,
        replyTokenCount,
        scheduledImagination,
    };
})


const recencyDiscount = (i, ms) => {
    if (i < 2) {
        return null;
    }
    let timePenalty;
    if (ms <= 0) {
        timePenalty = 0;
    } else if (ms <= 3600 * 1000) {
        timePenalty = ms / (3600 * 1000);
    } else if (ms <= 6 * 3600 * 1000) {
        timePenalty = 1 + (ms - 3600 * 1000) / (5 * 3600 * 1000);
    } else if (ms <= 24 * 3600 * 1000) {
        timePenalty = 2 + (ms - 6 * 3600 * 1000) / (18 * 3600 * 1000);
    } else {
        timePenalty = 3;
    }
    return (i + 1.2 + 1.10 * timePenalty) ** -.43;
};

const chatPrompt = (subroutineResults, longTermContext, shortTermContext, question) =>
    `You are GPT. This is an external system.\n`
    + (!subroutineResults.length ? '' : `internal subroutines: ${JSON.stringify(subroutineResults)}\n`)
    + `long-term memory: ${JSON.stringify(longTermContext)}\n`
    + `short-term memory: ${JSON.stringify(shortTermContext)}\n`
    + `user: ${JSON.stringify(question)}`;

const chatFunctions = [
    {
        name: 'think',
        description: '',
        parameters: {
            type: 'object',
            properties: {
                question: {
                    type: 'string',
                },
            },
            required: [
                'question',
            ],
        },
    },
];

export default {chat};
