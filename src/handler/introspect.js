import introspection from '../service/introspection.js';
import wrapper from '../util/wrapper.js';

const introspect = wrapper.logCorrelationId('handler.introspect.introspect', async (correlationId, body) => {
    const {chatId, index} = body;
    if (!chatId || !(index || index === 0)) {
        throw new Error('fields `chatId` and `index` required');
    }
    return await introspection.introspect(correlationId, chatId, index);
});

export default {introspect};
