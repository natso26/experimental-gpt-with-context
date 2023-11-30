import user_ from '../service/support/user.js';
import history_ from '../service/support/history.js';
import common from './common.js';
import wrapper from '../util/wrapper.js';

const externalHistory = wrapper.logCorrelationId('handler.history.externalHistory', async (correlationId, body) => {
    const {userId, sessionId, offset, limit} = body;
    if (!common.isUuidV4(userId)
        || !common.isUuidV4(sessionId)
        || !(common.isInteger(offset) && offset >= 0)
        || !(common.isInteger(limit) && limit >= 1)) {
        throw new Error('fields `userId`, `sessionId` must be UUID v4; `offset` must be nonnegative integer; `limit` must be positive integer');
    }
    const {isDev} = await user_.getRole(correlationId, userId);
    const ret = await history_.getHistory(correlationId, userId, sessionId, offset, limit);
    if (!isDev) {
        const {history} = ret;
        return {history};
    } else {
        return ret;
    }
});

export default {
    externalHistory,
};
