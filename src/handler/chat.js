import chat_ from '../service/chat.js';
import wrapper from '../util/wrapper.js';

const chat = wrapper.logCorrelationId('handler.chat.chat', async (correlationId, body) => {
    const {chatId, question} = body;
    if (!(typeof chatId === 'string' && chatId) || !(typeof question === 'string' && question)) {
        throw new Error('field `chatId` or `question` is invalid');
    }
    return await chat_.chat(correlationId, chatId, question);
});

export default {chat};
