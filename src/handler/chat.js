import chat_ from '../service/chat.js';
import common from './common.js';
import wrapper from '../util/wrapper.js';

const chat = wrapper.logCorrelationId('handler.chat.chat', async (correlationId, body) => {
    const {chatId, query, subroutineQuery, forbiddenRecursedQueries} = body;
    if (!common.isNonEmptyString(chatId)
        || !common.isNonEmptyString(query)
        || !(subroutineQuery === undefined || common.isNonEmptyString(subroutineQuery))
        || !(forbiddenRecursedQueries === undefined || (Array.isArray(forbiddenRecursedQueries) && forbiddenRecursedQueries.every(common.isNonEmptyString)))) {
        throw new Error('field `chatId`, `query`, `subroutineQuery`, or `forbiddenRecursedQueries` is invalid');
    }
    return await chat_.chat(correlationId, chatId, query, subroutineQuery || null, forbiddenRecursedQueries || []);
});

export default {
    chat,
};
