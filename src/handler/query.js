import user_ from '../service/support/user.js';
import query_ from '../service/active/query.js';
import common from './common.js';
import wrapper from '../util/wrapper.js';

const externalQuery = wrapper.logCorrelationId('handler.query.externalQuery', async (correlationId, onPartial, body) => {
    const {ip: ip_, userId, sessionId, options: options_, query} = body;
    const options = {timezoneOffset: 'auto', ip: ip_, ...(options_ || {})};
    const {timezoneOffset, ip} = options;
    if (!common.isUuidV4(userId)) {
        throw new Error(`field \`userId\` must be UUID v4: ${userId}`);
    }
    if (!common.isUuidV4(sessionId)) {
        throw new Error(`field \`sessionId\` must be UUID v4: ${sessionId}`);
    }
    if (!common.isTimezoneOffsetOption(timezoneOffset)) {
        throw new Error(`field \`options.timezoneOffset\` must be null, 'auto', or integer: ${timezoneOffset}`);
    }
    if (!common.isNonEmptyString(ip)) {
        throw new Error(`field \`options.ip\` must be nonempty string: ${ip}`);
    }
    if (!common.isNonEmptyString(query)) {
        throw new Error(`field \`query\` must be nonempty string: ${query}`);
    }
    const {isDev} = await user_.getRole(correlationId, userId);
    let partialReply = '';
    const onPartial_ = !onPartial ? null : (o) => {
        switch (o.event) {
            case 'task':
                partialReply = '';
                onPartial({event: 'task', kind: o.kind});
                break;
            case 'task-start':
                partialReply = '';
                onPartial({event: 'task-start', kind: o.kind});
                break;
            case 'reply':
                const oldPartialReply = partialReply;
                partialReply = o.content;
                if (partialReply.startsWith(oldPartialReply)) {
                    const diff = partialReply.slice(oldPartialReply.length);
                    onPartial({event: 'reply', diff});
                } else {
                    onPartial({event: 'reply', reply: partialReply});
                }
                break;
        }
    };
    const queryInfo = {
        query, recursedQueryStack: null, recursedNote: null, backupRecursedQuery: null, recursedQuery: null,
    };
    const ret = await query_.query(correlationId, onPartial_, userId, sessionId, options, queryInfo);
    if (!isDev) {
        const {reply} = ret;
        return {reply};
    } else {
        return ret;
    }
});

const internalQuery = wrapper.logCorrelationId('handler.query.internalQuery', async (correlationId, body) => {
    const {userId, sessionId, options, queryInfo} = body;
    const {timezoneOffset, ip} = options;
    const {query, recursedQueryStack, recursedNote, backupRecursedQuery, recursedQuery} = queryInfo;
    if (!common.isUuidV4(userId)
        || !common.isUuidV4(sessionId)
        || !common.isTimezoneOffsetOption(timezoneOffset)
        || !common.isNonEmptyString(ip)
        || !common.isNonEmptyString(query)
        || !common.isArrayOf(common.isNonEmptyString, recursedQueryStack)
        || !(recursedNote === null || common.isNonEmptyString(recursedNote))
        || !common.isNonEmptyString(backupRecursedQuery)
        || !common.isNonEmptyString(recursedQuery)) {
        throw new Error('some fields are invalid');
    }
    return await query_.query(correlationId, null, userId, sessionId, options, queryInfo);
});

export default {
    externalQuery,
    internalQuery,
};
