import history_ from '../service/history.js';
import common from './common.js';
import wrapper from '../util/wrapper.js';

const history = wrapper.logCorrelationId('handler.history.history', async (correlationId, body) => {
    const {sessionId, offset, limit} = body;
    if (!common.isNonEmptyString(sessionId)
        || !(common.isInteger(offset) && offset >= 0)
        || !(common.isInteger(limit) && limit >= 1)) {
        throw new Error('field `sessionId`, `offset`, or `limit` is invalid');
    }
    return await history_.getHistory(correlationId, sessionId, offset, limit);
});

export default {
    history,
};
