import chat from '../../repository/llm/chat.js';
import common from '../common.js';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';
import time from '../../util/time.js';

const MODEL_PROMPT_KIND_FIELD = 'kind';
const MODEL_PROMPT_RECURSED_NOTE_FIELD = 'recursedNote';
const MODEL_PROMPT_RECURSED_QUERY_FIELD = 'recursedQuery';
const MODEL_PROMPT_QUERY_FIELD = 'query';
const MODEL_PROMPT_REPLY_FIELD = 'reply';
const MODEL_PROMPT = (promptOptions, history, actions, query, recursedNote, recursedQuery) =>
    common.MODEL_PROMPT_CORE_MSG
    + `\n${common.MODEL_PROMPT_INTERNAL_COMPONENT_MSG}`
    + `\n${common.MODEL_PROMPT_OPTIONS_PART(promptOptions)}`
    + `\nhistory: ${JSON.stringify(history)}`
    + (!actions.length ? '' : `\ninternal actions, unknown to user: ${JSON.stringify(actions)}`)
    + `\nquery: ${JSON.stringify(query)}`
    + (!recursedNote ? '' : `\ninternal recursed note: ${JSON.stringify(recursedNote)}`)
    + (recursedQuery === query ? '' : `\ninternal recursed query: ${JSON.stringify(recursedQuery)}`)
    + `\n${recursedQuery === query ? 'come up with' : 'improve or restate'} internal recursed query, for search engine`;
const REVISION_TOKEN_COUNT_LIMIT = strictParse.int(process.env.REVISE_REVISION_TOKEN_COUNT_LIMIT);

const revise = wrapper.logCorrelationId('service.active.revision.revise', async (correlationId, docId, queryInfo, history, actions, promptOptions) => {
    const {query, recursedNote, recursedQuery} = queryInfo;
    const warnings = common.warnings();
    const prompt = MODEL_PROMPT(
        promptOptions, history, actions, query, recursedNote, recursedQuery);
    log.log('revise: prompt', {correlationId, docId, prompt});
    const chatTimer = time.timer();
    const {content: revision_, finishReason, usage} = await common.chatWithRetry(
        correlationId, null, prompt, REVISION_TOKEN_COUNT_LIMIT, null, null, warnings);
    const elapsedChat = chatTimer.elapsed();
    log.log('revise: revision', {correlationId, docId, revision: revision_});
    let revision;
    // NB: case directly reply instead of revise query
    if (finishReason === chat.FINISH_REASON_LENGTH) {
        log.log('revise: revision too long; use original', {correlationId, docId});
        revision = cleanRevision(recursedQuery);
    } else {
        revision = cleanRevision(revision_);
    }
    return {
        reply: revision,
        usage,
        timeStats: {
            elapsedChat,
        },
        warnings: warnings.get(),
    };
});

const cleanRevision = (() => {
    const UNWRAP_REGEXP = /^[^:]*(?:refine|internal|search)[^:]+query[^:]*: *"(.*)" *$/i; // e.g. Refine the internal query to: "..."
    const _cutInfo = (s, s2 = null) => [s, (s2 ?? s).length];
    const CUT_INFOS = [
        _cutInfo('please '),
        _cutInfo('provide '),
        _cutInfo('search for '),
        _cutInfo('research on '),
        _cutInfo('research the ', 'research '),
        _cutInfo('investigate the ', 'investigate '),
        _cutInfo('information on '),
    ];
    return (revision) => {
        let r = revision.split('\n').at(-1).trim();
        const match = UNWRAP_REGEXP.exec(r);
        r = !match ? revision : match[1];
        if (r[0] === '"' && r.at(-1) === '"') r = r.slice(1, -1);
        r = r.trim();
        if (['.', '?'].includes(r.at(-1))) r = r.slice(0, -1);
        for (const [s, l] of CUT_INFOS) {
            if (r.toLowerCase().startsWith(s)) r = r.slice(l).trimStart();
        }
        return r;
    };
})();

export default {
    MODEL_PROMPT_KIND_FIELD,
    MODEL_PROMPT_RECURSED_NOTE_FIELD,
    MODEL_PROMPT_RECURSED_QUERY_FIELD,
    MODEL_PROMPT_QUERY_FIELD,
    MODEL_PROMPT_REPLY_FIELD,
    revise,
};
