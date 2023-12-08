import user_ from '../service/support/user.js';
import history_ from '../service/support/history.js';
import common from './common.js';
import wrapper from '../util/wrapper.js';

const externalHistory = wrapper.logCorrelationId('handler.history.externalHistory', async (correlationId, body) => {
    const {userId, sessionId, offset, limit} = body;
    if (!common.isUuidV4(userId)) {
        throw new Error(`field \`userId\` must be UUID v4: ${userId}`);
    }
    if (!common.isUuidV4(sessionId)) {
        throw new Error(`field \`sessionId\` must be UUID v4: ${sessionId}`);
    }
    if (!common.isInteger(offset) || !(offset >= 0)) {
        throw new Error(`field \`offset\` must be nonnegative integer: ${offset}`);
    }
    if (!common.isInteger(limit) || !(limit >= 1)) {
        throw new Error(`field \`limit\` must be positive integer: ${limit}`);
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
