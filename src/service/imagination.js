import memory from '../repository/memory.js';
import common from './common.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const imagine = wrapper.logCorrelationId('service.imagination.imagine', async (correlationId) => {
    log.log('imagination parameters', {correlationId});
    const refTime = new Date();
    log.log('imagination reference time', {correlationId, refTime});
    const imagineRes = await memory.imagine(correlationId, refTime, async (chatId) => {
        log.log(`imagine for chat ID ${chatId}`, {correlationId, chatId});
        let referenceEmbedding;
        const rawLongTermContext = await memory.longTermSearch(correlationId, chatId, (getConsolidations, consolidation) => {
            if (!referenceEmbedding) {
                const cs = getConsolidations();
                const c = cs[Math.floor(Math.random() * cs.length)];
                const {summary, imagination} = c;
                log.log(`selected reference imagination item for chat ID ${chatId}`,
                    {correlationId, chatId, summary, imagination});
                referenceEmbedding = c.summaryEmbedding || c.imaginationEmbedding;
            }
            const targetEmbedding = consolidation.summaryEmbedding || consolidation.imaginationEmbedding;
            return common.cosineSimilarity(referenceEmbedding, targetEmbedding);
        }, 4);
        if (!rawLongTermContext.length) {
            log.log(`chat ID ${chatId} has no long-term memory, so we do not imagine`, {correlationId, chatId});
            return {imagination: null};
        }
        const longTermContext = rawLongTermContext.map(
            ([{summary, imagination},]) => !imagination ? summary : imagination);
        log.log(`imagination context for chat ID ${chatId}`, {correlationId, chatId, longTermContext});
        const messages = chatMessages(longTermContext);
        log.log('imagination messages', {correlationId, chatId, messages});
        const imagination = await common.chatWithRetry(correlationId, messages);
        const imaginationEmbedding = await common.embedWithRetry(correlationId, imagination);
        const index = await memory.addImagination(correlationId, chatId, {
            imagination,
            imaginationEmbedding,
        });
        return {index, imagination};
    });
    return {
        imagineRes,
    };
});

const chatMessages = (longTermContext) => [
    {
        role: 'system',
        content: `You are GPT. This is an internal system.\nlong-term memory: ${JSON.stringify(longTermContext)}\nthoughts`,
    },
];

export default {imagine};
