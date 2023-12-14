import common from '../common.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';
import time from '../../util/time.js';

const MODEL_PROMPT_RECURSED_NOTE_FIELD = 'recursedNote';
const MODEL_PROMPT_RECURSED_QUERY_FIELD = 'recursedQuery';
const MODEL_PROMPT_QUERY_FIELD = 'query';
const MODEL_PROMPT_REPLY_FIELD = 'reply';
const MODEL_PROMPT = (promptOptions, shortTermHistory, actions, query, recursedNote, recursedQuery) =>
    common.MODEL_PROMPT_CORE_MSG
    + `\n${common.MODEL_PROMPT_INTERNAL_COMPONENT_MSG}`
    + `\n${common.MODEL_PROMPT_OPTIONS_PART(promptOptions)}`
    + `\nshort-term history: ${JSON.stringify(shortTermHistory)}`
    + (!actions.length ? '' : `\ninternal actions, unknown to user: ${JSON.stringify(actions)}`)
    + `\nquery: ${JSON.stringify(query)}`
    + (!recursedNote ? '' : `\ninternal recursed note: ${JSON.stringify(recursedNote)}`)
    + (recursedQuery === query ? '' : `\ninternal recursed query: ${JSON.stringify(recursedQuery)}`)
    + `\n${recursedQuery === query ? 'come up with' : 'revise'} internal recursed query`;

const revise = wrapper.logCorrelationId('service.active.revision.revise', async (correlationId, docId, query, recursedNote, recursedQuery, shortTermHistory, actions, promptOptions) => {
    const warnings = common.warnings();
    const prompt = MODEL_PROMPT(
        promptOptions, shortTermHistory, actions, query, recursedNote, recursedQuery);
    log.log('revise: prompt', {correlationId, docId, prompt});
    const chatTimer = time.timer();
    const {content: revision, usage} = await common.chatWithRetry(
        correlationId, null, prompt, 9999, null, null, warnings);
    const elapsedChat = chatTimer.elapsed();
    return {
        reply: revision,
        usage,
        cost: common.CHAT_COST(usage),
        timeStats: {
            elapsedChat,
        },
        warnings: warnings.get(),
    };
});

export default {
    revise,
};
