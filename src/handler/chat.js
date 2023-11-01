import chat_ from '../service/chat.js';
import wrapper from '../util/wrapper.js';

const chat = wrapper.logCorrelationId('handler.chat.chat', async (correlationId, body) => {
    const {chatId, message} = body;
    if (!(typeof chatId === 'string' && chatId) || !(typeof message === 'string' && message)) {
        throw new Error('field `chatId` or `message` is invalid');
    }
    return await chat_.chat(correlationId, chatId, message);
});

export default {chat};
