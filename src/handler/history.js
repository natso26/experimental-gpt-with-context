import history_ from '../service/history.js';
import common from './common.js';
import wrapper from '../util/wrapper.js';

const history = wrapper.logCorrelationId('handler.history.history', async (correlationId, body) => {
    const {chatId, offset, limit} = body;
    if (!common.isNonEmptyString(chatId)
        || !(common.isInteger(offset) && offset >= 0)
        || !(common.isInteger(limit) && limit >= 1)) {
        throw new Error('field `chatId`, `offset`, or `limit` is invalid');
    }
    return await history_.getHistory(correlationId, chatId, offset, limit);
});

export default {
    history,
};
