import introspection from '../service/introspection.js';
import common from './common.js';
import wrapper from '../util/wrapper.js';

const introspect = wrapper.logCorrelationId('handler.introspect.introspect', async (correlationId, body) => {
    const {chatId, index} = body;
    if (!common.isNonEmptyString(chatId)
        || !(common.isInteger(index) && index >= 0)) {
        throw new Error('field `chatId` or `index` is invalid');
    }
    return await introspection.introspect(correlationId, chatId, index);
});

export default {
    introspect,
};
