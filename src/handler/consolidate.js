import consolidation from '../service/consolidation.js';
import wrapper from '../util/wrapper.js';

const consolidate = wrapper.logCorrelationId('handler.consolidate.consolidate', async (correlationId, body) => {
    const {chatId} = body;
    if (!(typeof chatId === 'string' && chatId)) {
        throw new Error('field `chatId` is invalid');
    }
    return await consolidation.consolidate(correlationId, chatId);
});

export default {consolidate};
