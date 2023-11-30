import user_ from '../service/support/user.js';
import query_ from '../service/active/query.js';
import common from './common.js';
import wrapper from '../util/wrapper.js';

const externalQuery = wrapper.logCorrelationId('handler.query.externalQuery', async (correlationId, body) => {
    const {userId, sessionId, query} = body;
    if (!common.isUuidV4(userId)
        || !common.isUuidV4(sessionId)
        || !common.isNonEmptyString(query)) {
        throw new Error('fields `userId`, `sessionId` must be UUID v4; `query` must be nonempty string');
    }
    const {isDev} = await user_.getRole(correlationId, userId);
    const ret = await query_.query(correlationId, userId, sessionId, query, null, null);
    if (!isDev) {
        const {reply} = ret;
        return {reply};
    } else {
        return ret;
    }
});

const internalQuery = wrapper.logCorrelationId('handler.query.internalQuery', async (correlationId, body) => {
    const {userId, sessionId, query, recursedNote, recursedQuery} = body;
    if (!common.isUuidV4(userId)
        || !common.isUuidV4(sessionId)
        || !common.isNonEmptyString(query)
        || !(recursedNote === null || common.isNonEmptyString(recursedNote))
        || !(recursedQuery === null || common.isNonEmptyString(recursedQuery))) {
        throw new Error('some fields are invalid');
    }
    return await query_.query(correlationId, userId, sessionId, query, recursedNote, recursedQuery);
});

export default {
    externalQuery,
    internalQuery,
};
