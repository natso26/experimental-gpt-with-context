import memory from '../repository/memory.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const getHistory = wrapper.logCorrelationId('service.history.getHistory', async (correlationId, chatId, offset, limit) => {
    log.log('history parameters', {correlationId, chatId, offset, limit});
    const rawElts = await memory.getHistory(correlationId, chatId, offset, limit);
    return rawElts.map(({question, reply}) => ({question, reply}));
});

export default {getHistory};
