import user_ from '../service/user.js';
import query_ from '../service/query.js';
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
    const ret = await query_.query(correlationId, userId, sessionId, query, null, []);
    if (!isDev) {
        const {reply} = ret;
        return {reply};
    } else {
        return ret;
    }
});

const internalQuery = wrapper.logCorrelationId('handler.query.internalQuery', async (correlationId, body) => {
    const {userId, sessionId, query, subroutineQuery, forbiddenRecursedQueries} = body;
    if (!common.isUuidV4(userId)
        || !common.isUuidV4(sessionId)
        || !common.isNonEmptyString(query)
        || !(subroutineQuery === null || common.isNonEmptyString(subroutineQuery))
        || !(Array.isArray(forbiddenRecursedQueries) && forbiddenRecursedQueries.every(common.isNonEmptyString))) {
        throw new Error('some fields are invalid');
    }
    return await query_.query(correlationId, userId, sessionId, query, subroutineQuery, forbiddenRecursedQueries);
});

export default {
    externalQuery,
    internalQuery,
};
