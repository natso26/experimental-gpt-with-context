import user_ from '../service/support/user.js';
import details_ from '../service/support/details.js';
import common from './common.js';
import wrapper from '../util/wrapper.js';

const externalDetails = wrapper.logCorrelationId('handler.details.externalDetails', async (correlationId, body) => {
    const {userId, sessionId, item} = body;
    if (!common.isUuidV4(userId)) {
        throw new Error(`field \`userId\` must be UUID v4: ${userId}`);
    }
    if (!common.isUuidV4(sessionId)) {
        throw new Error(`field \`sessionId\` must be UUID v4: ${sessionId}`);
    }
    if (!common.isInteger(item) || !(item >= 0)) {
        throw new Error(`field \`item\` must be nonnegative integer: ${item}`);
    }
    const {isDev} = await user_.getRole(correlationId, userId);
    const ret = await details_.getDetails(correlationId, userId, sessionId, item);
    if (!isDev) {
        const {overviewYaml, overview} = ret;
        return {overviewYaml, overview};
    } else {
        return ret;
    }
});

export default {
    externalDetails,
};
