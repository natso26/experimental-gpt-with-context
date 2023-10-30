import embedding from '../repository/embedding.js';
import memory from '../repository/memory.js';
import chat from '../repository/chat.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const consolidate = wrapper.logCorrelationId('service.consolidation.consolidate', async (correlationId, chatId) => {
    log.log('consolidation parameters', {correlationId, chatId});
    await memory.consolidate(correlationId, chatId, async (lvl, raw) => {
        const input = lvl ? raw.map(({summary}) => summary)
            : raw.map(({question, reply, introspection}) =>
                !introspection ? {question, reply} : {introspection});
        log.log('consolidation input', {correlationId, lvl, input});
        const summary = await chat.chat(correlationId, [{
            role: 'system',
            content: `summarize ${JSON.stringify(input)}`,
        }]);
        const summaryEmbedding = await embedding.embed(correlationId, summary);
        return {summary, summaryEmbedding};
    });
});

export default {consolidate};
