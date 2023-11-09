import tokenizer from '../repository/tokenizer.js';
import memory from '../repository/memory.js';
import common from './common.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const chat = wrapper.logCorrelationId('service.chat.chat', async (correlationId, chatId, message) => {
    log.log('chat parameters', {correlationId, chatId, question: message});
    const messageTokenCount = await tokenizer.countTokens(correlationId, message);
    log.log('message token count', {correlationId, chatId, messageTokenCount});
    if (messageTokenCount > 256) {
        throw new Error(`message exceeds maximum length of 256 tokens: ${messageTokenCount} tokens`);
    }
    const questionEmbedding = await common.embedWithRetry(correlationId, message);
    const refTime = new Date();
    const rawShortTermContext = await memory.shortTermSearch(correlationId, chatId, (elt, i, timestamp) => {
        const discount = recencyDiscount(i, refTime - timestamp);
        if (discount === null) {
            return 99 - i;
        }
        const targetEmbedding = elt.questionEmbedding || elt.introspectionEmbedding;
        return 10 * common.cosineSimilarity(questionEmbedding, targetEmbedding) * discount;
    }, 7);
    const shortTermContext = rawShortTermContext.reverse().map(
        ([{question, reply, introspection}, relevance]) =>
            !introspection ? {relevance, question, reply} : {relevance, introspection});
    log.log('searched short-term context', {correlationId, chatId, shortTermContext});
    const rawLongTermContext = await memory.longTermSearch(correlationId, chatId, (_, consolidation) => {
        const targetEmbedding = consolidation.summaryEmbedding || consolidation.imaginationEmbedding;
        return common.cosineSimilarity(questionEmbedding, targetEmbedding);
    }, 2);
    const longTermContext = rawLongTermContext.reverse().map(
        ([{summary, imagination},]) =>
            !imagination ? {summary} : {imagination});
    log.log('searched long-term context', {correlationId, chatId, longTermContext});
    const messages = chatMessages(shortTermContext, longTermContext, message);
    log.log('chat messages', {correlationId, chatId, messages});
    const reply = await common.chatWithRetry(correlationId, messages);
    log.log('chat reply', {correlationId, chatId, reply});
    const replyTokenCount = await tokenizer.countTokens(correlationId, reply);
    log.log('reply token count', {correlationId, chatId, replyTokenCount});
    const index = await memory.add(correlationId, chatId, {
        question: message,
        questionTokenCount: messageTokenCount,
        questionEmbedding,
        reply,
        replyTokenCount,
    }, false);
    // in background
    fetch(`${process.env.BACKGROUND_TASK_HOST}/api/consolidate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Correlation-Id': correlationId,
        },
        body: JSON.stringify({chatId}),
    }).catch((e) =>
        log.log('fetch consolidate failed, may have timed out', {
            correlationId, chatId, error: e.message || '', stack: e.stack || '',
        }));
    // in background
    fetch(`${process.env.BACKGROUND_TASK_HOST}/api/introspect`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Correlation-Id': correlationId,
        },
        body: JSON.stringify({chatId, index}),
    }).catch((e) =>
        log.log('fetch introspect failed, may have timed out', {
            correlationId, chatId, error: e.message || '', stack: e.stack || '',
        }));
    const scheduledImagination = await memory.scheduleImagination(correlationId, chatId, (curr) => {
        if (curr) {
            return curr;
        }
        const scheduledImagination = new Date(
            new Date().getTime() + 6 * 3600 * 1000 + Math.random() * 6 * 3600 * 1000);
        log.log('scheduled imagination', {correlationId, chatId, scheduledImagination});
        return scheduledImagination;
    }).catch((e) => {
        log.log('schedule imagination failed, continue since it is low-priority task', {
            correlationId, chatId, error: e.message || '', stack: e.stack || '',
        });
        return null;
    });
    return {
        index,
        reply,
        replyTokenCount,
        shortTermContext,
        longTermContext,
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

const chatMessages = (shortTermContext, longTermContext, message) => [
    {
        role: 'system',
        content: `This is an external system.\nlong-term memory: ${JSON.stringify(longTermContext)}\nshort-term memory: ${JSON.stringify(shortTermContext)}\nuser: ${JSON.stringify(message)}`,
    },
];

export default {chat};
