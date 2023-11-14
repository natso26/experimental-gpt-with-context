import tokenizer from '../repository/tokenizer.js';
import memory from '../repository/memory.js';
import common from './common.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const introspect = wrapper.logCorrelationId('service.introspection.introspect', async (correlationId, chatId, index) => {
    log.log('introspection parameters', {correlationId, chatId, index});
    const waitTime = Math.exp(Math.log(3 * 60) + Math.random() * Math.log(5));
    log.log('wait time', {correlationId, chatId, waitTime});
    await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
    const [rawElts, latestIndex] = await memory.getLatest(correlationId, chatId, 12);
    if (latestIndex !== index) {
        log.log('do not introspect due to index being outdated', {correlationId, index, latestIndex});
        return {introspection: null};
    }
    const unslicedElts = rawElts.filter(({introspection}) => !introspection)
        .map(({question, reply}) => ({question, reply}));
    const elts = unslicedElts.length <= 6 ? unslicedElts : unslicedElts.slice(unslicedElts.length - 6);
    log.log('elements', {correlationId, chatId, elts});
    const messages = chatMessages(elts);
    log.log('introspection messages', {correlationId, chatId, messages});
    const introspection = await common.chatWithRetry(correlationId, messages);
    const introspectionEmbedding = await common.embedWithRetry(correlationId, introspection);
    const introspectionTokenCount = await tokenizer.countTokens(correlationId, introspection);
    const introspectionIndex = await memory.add(correlationId, chatId, {
        introspection,
        introspectionTokenCount,
        introspectionEmbedding,
    }, true);
    return {
        introspectionIndex,
        introspection,
        introspectionTokenCount,
    };
});

const chatMessages = (elts) => [
    {
        role: 'system',
        content: `You are GPT. This is an internal system.\nshort-term memory: ${JSON.stringify(elts)}\nthoughts`,
    },
];

export default {introspect};
