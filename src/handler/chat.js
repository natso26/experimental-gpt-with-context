import chat_ from '../service/chat.js';
import wrapper from '../util/wrapper.js';

const chat = wrapper.logCorrelationId('handler.chat.chat', async (correlationId, body) => {
    const {chatId, question, isSubroutine} = body;
    if (!(typeof chatId === 'string' && chatId) || !(typeof question === 'string' && question)
        || !(typeof isSubroutine === 'boolean' || isSubroutine === undefined)) {
        throw new Error('field `chatId`, `question`, or `isSubroutine` is invalid');
    }
    return await chat_.chat(correlationId, chatId, question, isSubroutine || false);
});

export default {chat};
