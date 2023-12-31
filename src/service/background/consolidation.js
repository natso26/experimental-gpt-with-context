import memory from '../../repository/db/memory.js';
import common from '../common.js';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';
import time from '../../util/time.js';

const MODEL_PROMPT_QUERY_FIELD = 'query';
const MODEL_PROMPT_REPLY_FIELD = 'reply';
const MODEL_PROMPT_INTROSPECTION_FIELD = 'introspection';
const MODEL_PROMPT_TEXT_FIELD = 'text';
const MODEL_PROMPT = (context) =>
    common.MODEL_PROMPT_CORE_MSG
    + `\n${common.MODEL_PROMPT_INTERNAL_COMPONENT_MSG}`
    + `\n${common.MODEL_PROMPT_OPTIONS_PART(common.EMPTY_PROMPT_OPTIONS())}`
    + `\ncontext: ${JSON.stringify(context)}`
    + `\nconsolidate`;
const TOKEN_COUNT_LIMIT = strictParse.int(process.env.CONSOLIDATION_TOKEN_COUNT_LIMIT);

const consolidate = wrapper.logCorrelationId('service.background.consolidation.consolidate', async (correlationId, userId, sessionId) => {
    log.log('consolidate: parameters', {correlationId, userId, sessionId});
    const docId = common.DOC_ID.from(userId, sessionId);
    const rawConsolidationRes = await memory.consolidate(correlationId, docId, async (lvl, raw) => {
        const warnings = common.warnings();
        const timer = time.timer();
        // NB: {text: summary} > {summary}
        const context = lvl ? raw.map((
            {
                [common.SUMMARY_FIELD]: summary,
            }) => ({
            [MODEL_PROMPT_TEXT_FIELD]: summary,
        })) : raw.map((
            {
                [common.QUERY_FIELD]: query,
                [common.REPLY_FIELD]: reply,
                [common.INTROSPECTION_FIELD]: introspection,
            }) => !introspection ? {
            [MODEL_PROMPT_QUERY_FIELD]: query,
            [MODEL_PROMPT_REPLY_FIELD]: reply,
        } : {
            [MODEL_PROMPT_INTROSPECTION_FIELD]: introspection,
        });
        log.log('consolidate: context', {correlationId, docId, lvl, context});
        const prompt = MODEL_PROMPT(context);
        log.log('consolidate: prompt', {correlationId, docId, lvl, prompt});
        const chatTimer = time.timer();
        const {content: summary, usage} = await common.chatWithRetry(
            correlationId, null, prompt, {maxTokens: TOKEN_COUNT_LIMIT},
            null, null, warnings);
        const elapsedChat = chatTimer.elapsed();
        const {embedding: summaryEmbedding} = await common.embedWithRetry(correlationId, summary);
        const extra = {
            correlationId,
            context,
            usage,
            cost: common.CHAT_COST(usage),
            timeStats: {
                elapsed: timer.elapsed(),
                elapsedChat,
            },
        };
        const dbExtra = {
            ...extra,
            prompt,
            warnings: warnings.get(),
        };
        return {
            consolidation: {
                [common.SUMMARY_FIELD]: summary,
                [common.SUMMARY_EMBEDDING_FIELD]: summaryEmbedding,
            },
            extra: dbExtra,
            passOnRet: {
                summary,
                ...extra,
                warnings: warnings.get(),
            },
        };
    });
    const consolidationRes = rawConsolidationRes.map(
        ({lvl, index, timestamp, passOnRet}) => ({lvl, index, timestamp, ...passOnRet}));
    return {
        consolidationRes,
    };
});

export default {
    consolidate,
};
