import memory from '../repository/memory.js';
import common from './common.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const getHistory = wrapper.logCorrelationId('service.history.getHistory', async (correlationId, userId, sessionId, offset, limit) => {
    log.log('history: parameters', {correlationId, sessionId, offset, limit});
    const docId = common.DOC_ID.from(userId, sessionId);
    const rawHistory = await memory.getHistory(correlationId, docId, offset, limit);
    const history = rawHistory.map((
        {
            [common.QUERY_FIELD]: query,
            [common.REPLY_FIELD]: reply,
        }) => ({query, reply}));
    return {
        history,
    };
});

export default {
    getHistory,
};
