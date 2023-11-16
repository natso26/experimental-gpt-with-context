import chat_ from '../service/chat.js';
import wrapper from '../util/wrapper.js';

const chat = wrapper.logCorrelationId('handler.chat.chat', async (correlationId, body) => {
    const {chatId, query, isSubroutine} = body;
    if (!(typeof chatId === 'string' && chatId) || !(typeof query === 'string' && query)
        || !(typeof isSubroutine === 'boolean' || isSubroutine === undefined)) {
        throw new Error('field `chatId`, `query`, or `isSubroutine` is invalid');
    }
    return await chat_.chat(correlationId, chatId, query, isSubroutine || false);
});

export default {
    chat,
};
