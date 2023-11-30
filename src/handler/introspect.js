import introspection from '../service/background/introspection.js';
import common from './common.js';
import wrapper from '../util/wrapper.js';

const internalIntrospect = wrapper.logCorrelationId('handler.introspect.internalIntrospect', async (correlationId, body) => {
    const {userId, sessionId, index} = body;
    if (!common.isUuidV4(userId)
        || !common.isUuidV4(sessionId)
        || !(common.isInteger(index) && index >= 0)) {
        throw new Error('some fields are invalid');
    }
    return await introspection.introspect(correlationId, userId, sessionId, index);
});

export default {
    internalIntrospect,
};
