import tokenizer from '../repository/tokenizer.js';
import embedding from '../repository/embedding.js';
import memory from '../repository/memory.js';
import chat_ from '../repository/chat.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const chat = wrapper.logCorrelationId('service.chat.chat', async (correlationId, chatId, message) => {
    log.log('chat parameters', {correlationId, chatId, question: message});
    const messageTokenCount = await tokenizer.countTokens(correlationId, message);
    log.log('message token count', {correlationId, messageTokenCount});
    if (messageTokenCount > 256) {
        throw new Error(`message exceeds maximum length of 256 tokens: ${messageTokenCount} tokens`);
    }
    const questionEmbedding = await embedding.embed(correlationId, message);
    const refTime = new Date();
    const rawShortTermContext = await memory.shortTermSearch(correlationId, chatId, (elt, i, timestamp) => {
        const discount = recencyDiscount(i, refTime - timestamp);
        if (discount === null) {
            return 99 - i;
        }
        return 10 * cosineSimilarity(questionEmbedding, elt.questionEmbedding) * discount;
    }, 7);
    const shortTermContext = rawShortTermContext.reverse().map(
        ([{question, reply}, relevance]) => ({relevance, question, reply}));
    log.log('searched short-term context', {correlationId, shortTermContext});
    const rawLongTermContext = await memory.longTermSearch(correlationId, chatId, (consolidation) => {
        return cosineSimilarity(questionEmbedding, consolidation.summaryEmbedding);
    }, 2);
    const longTermContext = rawLongTermContext.reverse().map(
        ([{summary},]) => ({summary}));
    log.log('searched long-term context', {correlationId, longTermContext});
    const messages = [
        {
            role: 'system',
            content: `long-term memory: ${JSON.stringify(longTermContext)}\nshort-term memory: ${JSON.stringify(shortTermContext)}`,
        },
        {
            role: 'user',
            content: message,
        },
    ];
    log.log('chat messages', {correlationId, messages});
    const reply = await chat_.chat(correlationId, messages);
    log.log('chat reply', {correlationId, reply});
    const replyTokenCount = await tokenizer.countTokens(correlationId, reply);
    log.log('reply token count', {correlationId, replyTokenCount});
    await memory.add(correlationId, chatId, {
        question: message,
        questionTokenCount: messageTokenCount,
        questionEmbedding,
        reply,
        replyTokenCount,
    });
    // in background
    fetch(`${process.env.BACKGROUND_TASK_HOST}/consolidate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Correlation-Id': correlationId,
        },
        body: JSON.stringify({chatId}),
    });
    return {
        reply,
        shortTermContext,
        longTermContext,
    };
});

const cosineSimilarity = (a, b) => a.map((e, i) => e * b[i]).reduce((x, y) => x + y);
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

export default {chat};
