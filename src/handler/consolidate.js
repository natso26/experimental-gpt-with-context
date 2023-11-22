import consolidation from '../service/consolidation.js';
import common from './common.js';
import wrapper from '../util/wrapper.js';

const consolidate = wrapper.logCorrelationId('handler.consolidate.consolidate', async (correlationId, body) => {
    const {sessionId} = body;
    if (!common.isNonEmptyString(sessionId)) {
        throw new Error('field `sessionId` is invalid');
    }
    return await consolidation.consolidate(correlationId, sessionId);
});

export default {
    consolidate,
};
