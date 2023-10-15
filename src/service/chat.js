import cache from '../repository/cache.js';
import embedding from '../repository/embedding.js';
import chat_ from '../repository/chat.js';
import log from '../util/log.js';

const chat = async (message) => {
    const questionEmbedding = await embedding.embed(message);
    log.log('embedded question', {question: message});
    const rawContext = await cache.search((item, i, length) => {
        const discount = recencyDiscount(i, length);
        if (discount === null) {
            return 99 - (length - 1 - i);
        }
        return cosineSimilarity(questionEmbedding, item.questionEmbedding) * discount;
    }, 7);
    const context = rawContext.map(([{question, reply}, relevance]) => (
        {relevance, question, reply}));
    context.reverse();
    log.log('searched context', {context});
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
    log.log('chat messages', {messages});
    const reply = await chat_.chat(messages);
    await cache.add({
        questionEmbedding,
        question: message,
        reply,
    });
    log.log('chat reply', {reply})
    return {
        reply,
        context,
    };
};

const cosineSimilarity = (a, b) => a.map((e, i) => e * b[i]).reduce((x, y) => x + y);
const recencyDiscount = (i, length) => length - 1 - i < 2 ? null : (length - 1 - i) ** -.5;

export default {chat};
