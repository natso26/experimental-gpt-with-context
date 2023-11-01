import memory from '../repository/memory.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const getHistory = wrapper.logCorrelationId('service.history.getHistory', async (correlationId, chatId, offset, limit) => {
    log.log('history parameters', {correlationId, chatId, offset, limit});
    const rawHistory = await memory.getHistory(correlationId, chatId, offset, limit);
    const history = rawHistory.map(({question, reply}) => ({question, reply}));
    return {
        history,
    };
});

export default {getHistory};
