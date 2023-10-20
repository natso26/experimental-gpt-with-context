import chat_ from '../service/chat.js';
import wrapper from '../util/wrapper.js';

const chat = wrapper.logCorrelationId('handler.chat.chat', async (correlationId, body) => {
    const {chatId, message} = body;
    if (!chatId || !message) {
        throw new Error('fields `chatId` and `message` are required');
    }
    return await chat_.chat(correlationId, chatId, message);
});

export default {chat};
