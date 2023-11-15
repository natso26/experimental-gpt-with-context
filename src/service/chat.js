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
const MIN_SCHEDULED_IMAGINATION_DELAY = parseInt(process.env.CHAT_MIN_SCHEDULED_IMAGINATION_DELAY_MINUTES) * 60 * 1000;
const MAX_SCHEDULED_IMAGINATION_DELAY = parseInt(process.env.CHAT_MAX_SCHEDULED_IMAGINATION_DELAY_MINUTES) * 60 * 1000;

const chat = wrapper.logCorrelationId('service.chat.chat', async (correlationId, chatId, question) => {
    log.log('chat service parameters', {correlationId, chatId, question});
    const questionTokenCount = await tokenizer.countTokens(correlationId, question);
    log.log('chat question token count', {correlationId, chatId, questionTokenCount});
    if (questionTokenCount > QUESTION_TOKEN_COUNT_LIMIT) {
        throw new Error(`chat question token count exceeds limit of ${QUESTION_TOKEN_COUNT_LIMIT}: ${questionTokenCount}`);
    }
    const questionEmbedding = await common.embedWithRetry(correlationId, question);
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
    const prompt = chatPrompt(shortTermContext, longTermContext, question);
    log.log('chat prompt', {correlationId, chatId, prompt});
    const reply = await common.chatWithRetry(correlationId, prompt, REPLY_TOKEN_COUNT_LIMIT);
    const promptTokenCount = await tokenizer.countTokens(correlationId, prompt);
    const replyTokenCount = await tokenizer.countTokens(correlationId, reply);
    const {index, timestamp} = await memory.add(correlationId, chatId, {
        [common.QUESTION_FIELD]: question,
        [common.QUESTION_EMBEDDING_FIELD]: questionEmbedding,
        [common.REPLY_FIELD]: reply,
    }, {
        questionTokenCount,
        shortTermContext,
        longTermContext,
        prompt,
        promptTokenCount,
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
        prompt,
        promptTokenCount,
        replyTokenCount,
        scheduledImagination,
    };
});

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

const chatPrompt = (shortTermContext, longTermContext, question) =>
    `You are GPT. This is an external system.\nlong-term memory: ${JSON.stringify(longTermContext)}\nshort-term memory: ${JSON.stringify(shortTermContext)}\nuser: ${JSON.stringify(question)}`;

export default {chat};
