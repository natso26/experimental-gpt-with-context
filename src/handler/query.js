import query_ from '../service/query.js';
import common from './common.js';
import wrapper from '../util/wrapper.js';

const externalQuery = wrapper.logCorrelationId('handler.query.externalQuery', async (correlationId, body) => {
    const {sessionId, query} = body;
    if (!common.isNonEmptyString(sessionId)
        || !common.isNonEmptyString(query)) {
        throw new Error('field `sessionId` or `query` is invalid');
    }
    return await query_.query(correlationId, sessionId, query, null, []);
});

const internalQuery = wrapper.logCorrelationId('handler.query.internalQuery', async (correlationId, body) => {
    const {sessionId, query, subroutineQuery, forbiddenRecursedQueries} = body;
    if (!common.isNonEmptyString(sessionId)
        || !common.isNonEmptyString(query)
        || !(subroutineQuery === null || common.isNonEmptyString(subroutineQuery))
        || !(Array.isArray(forbiddenRecursedQueries) && forbiddenRecursedQueries.every(common.isNonEmptyString))) {
        throw new Error('field `sessionId`, `query`, `subroutineQuery`, or `forbiddenRecursedQueries` is invalid');
    }
    return await query_.query(correlationId, sessionId, query, subroutineQuery, forbiddenRecursedQueries);
});

export default {
    externalQuery,
    internalQuery,
};
