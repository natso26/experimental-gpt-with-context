import history_ from '../service/history.js';
import wrapper from '../util/wrapper.js';

const history = wrapper.logCorrelationId('handler.history.history', async (correlationId, body) => {
    const {chatId, offset, limit} = body;
    if (!(typeof chatId === 'string' && chatId) || !(typeof offset === 'number' && offset % 1 === 0 && offset >= 0)
        || !(typeof limit === 'number' && limit % 1 === 0 && limit >= 1)) {
        throw new Error('field `chatId`, `offset`, or `limit` is invalid');
    }
    return await history_.getHistory(correlationId, chatId, offset, limit);
});

export default {history};
