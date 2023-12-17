import research from '../service/active/research.js';
import common from './common.js';
import wrapper from '../util/wrapper.js';

const internalResearch = wrapper.logCorrelationId('handler.research.internalResearch', async (correlationId, body) => {
    const {userId, sessionId, options, queryInfo} = body;
    const {timezoneOffset, ip} = options;
    const {query, recursedNote, backupRecursedQuery, recursedQuery} = queryInfo;
    if (!common.isUuidV4(userId)
        || !common.isUuidV4(sessionId)
        || !common.isTimezoneOffsetOption(timezoneOffset)
        || !common.isNonEmptyString(ip)
        || !common.isNonEmptyString(query)
        || !(recursedNote === null || common.isNonEmptyString(recursedNote))
        || !common.isNonEmptyString(backupRecursedQuery)
        || !common.isNonEmptyString(recursedQuery)) {
        throw new Error('some fields are invalid');
    }
    return await research.research(correlationId, userId, sessionId, options, queryInfo);
});

export default {
    internalResearch,
};
