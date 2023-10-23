import memory from '../repository/memory.js';
import embedding from '../repository/embedding.js';
import chat_ from '../repository/chat.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const chat = wrapper.logCorrelationId('service.chat.chat', async (correlationId, chatId, message) => {
    log.log('chat parameters', {correlationId, chatId, question: message});
    const questionEmbedding = await embedding.embed(correlationId, message);
    const refTime = new Date();
    const rawContext = await memory.search(correlationId, chatId, (elt, i, timestamp) => {
        const discount = recencyDiscount(i, refTime - timestamp);
        if (discount === null) {
            return 99 - i;
        }
        return 10 * cosineSimilarity(questionEmbedding, elt.questionEmbedding) * discount;
    }, 7);
    const context = rawContext.reverse().map(
        ([{question, reply}, relevance]) => ({relevance, question, reply}));
    log.log('searched context', {correlationId, context});
    const messages = [
        {
            role: 'system',
            content: `long-term memory: []\nshort-term memory: ${JSON.stringify(context)}`,
        },
        {
            role: 'user',
            content: message,
        },
    ];
    log.log('chat messages', {correlationId, messages});
    const reply = await chat_.chat(correlationId, messages);
    await memory.add(correlationId, chatId, {
        questionEmbedding,
        question: message,
        reply,
    });
    log.log('chat reply', {correlationId, reply});
    return {
        reply,
        context,
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
