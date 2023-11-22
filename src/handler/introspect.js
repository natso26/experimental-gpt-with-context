import introspection from '../service/introspection.js';
import common from './common.js';
import wrapper from '../util/wrapper.js';

const introspect = wrapper.logCorrelationId('handler.introspect.introspect', async (correlationId, body) => {
    const {sessionId, index} = body;
    if (!common.isNonEmptyString(sessionId)
        || !(common.isInteger(index) && index >= 0)) {
        throw new Error('field `sessionId` or `index` is invalid');
    }
    return await introspection.introspect(correlationId, sessionId, index);
});

export default {
    introspect,
};
