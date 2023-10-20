import memory from '../repository/memory.js';
import embedding from '../repository/embedding.js';
import chat_ from '../repository/chat.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const chat = wrapper.logCorrelationId('service.chat.chat', async (correlationId, chatId, message) => {
    log.log('chat parameters', {correlationId, chatId, question: message});
    const questionEmbedding = await embedding.embed(correlationId, message);
    const rawContext = await memory.search(correlationId, chatId, (elt, i) => {
        const discount = recencyDiscount(i);
        if (discount === null) {
            return 99 - i;
        }
        return cosineSimilarity(questionEmbedding, elt.questionEmbedding) * discount;
    }, 7);
    const context = rawContext.reverse().map(
        ([{question, reply}, relevance]) => ({relevance, question, reply}));
    log.log('searched context', {correlationId, context});
    const messages = [
        {
            role: 'system',
            content: JSON.stringify(context),
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
const recencyDiscount = (i) => i < 2 ? null : i ** -.5;

export default {chat};
