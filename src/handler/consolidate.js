import consolidation from '../service/consolidation.js';
import common from './common.js';
import wrapper from '../util/wrapper.js';

const internalConsolidate = wrapper.logCorrelationId('handler.consolidate.internalConsolidate', async (correlationId, body) => {
    const {userId, sessionId} = body;
    if (!common.isUuidV4(userId)
        || !common.isUuidV4(sessionId)) {
        throw new Error('some fields are invalid');
    }
    return await consolidation.consolidate(correlationId, userId, sessionId);
});

export default {
    internalConsolidate,
};
