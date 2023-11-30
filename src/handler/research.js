import research from '../service/active/research.js';
import common from './common.js';
import wrapper from '../util/wrapper.js';

const internalResearch = wrapper.logCorrelationId('handler.research.internalResearch', async (correlationId, body) => {
    const {userId, sessionId, query, recursedNote, recursedQuery} = body;
    if (!common.isUuidV4(userId)
        || !common.isUuidV4(sessionId)
        || !common.isNonEmptyString(query)
        || !(recursedNote === null || common.isNonEmptyString(recursedNote))
        || !common.isNonEmptyString(recursedQuery)) {
        throw new Error('some fields are invalid');
    }
    return await research.research(correlationId, userId, sessionId, query, recursedNote, recursedQuery);
});

export default {
    internalResearch,
};
