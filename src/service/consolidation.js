import embedding from '../repository/embedding.js';
import memory from '../repository/memory.js';
import chat from '../repository/chat.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const consolidate = wrapper.logCorrelationId('service.consolidation.consolidate', async (correlationId, chatId) => {
    log.log('consolidation parameters', {correlationId, chatId});
    const rawConsolidationRes = await memory.consolidate(correlationId, chatId, async (lvl, raw) => {
        const input = lvl ? raw.map(({summary}) => summary)
            : raw.map(({question, reply, introspection}) =>
                !introspection ? {question, reply} : {introspection});
        log.log('consolidation input', {correlationId, lvl, input});
        const messages = chatMessages(input);
        log.log('consolidation messages', {correlationId, messages});
        const summary = await chat.chat(correlationId, messages);
        const summaryEmbedding = await embedding.embed(correlationId, summary);
        return {summary, summaryEmbedding};
    });
    const consolidationRes = rawConsolidationRes.map(({lvl, index, consolidation}) => {
        const {summary} = consolidation;
        return {lvl, index, summary};
    });
    return {
        consolidationRes,
    };
});

const chatMessages = (input) => [
    {
        role: 'system',
        content: `This is an internal system.\nsummarize ${JSON.stringify(input)}`,
    },
];

export default {consolidate};
