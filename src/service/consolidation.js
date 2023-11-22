import tokenizer from '../repository/tokenizer.js';
import memory from '../repository/memory.js';
import common from './common.js';
import strictParse from '../util/strictParse.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';
import time from '../util/time.js';

const MODEL_PROMPT_QUERY_FIELD = 'query';
const MODEL_PROMPT_REPLY_FIELD = 'reply';
const MODEL_PROMPT_INTROSPECTION_FIELD = 'introspection';
const MODEL_PROMPT_TEXT_FIELD = 'text';
const MODEL_PROMPT = (context) =>
    common.MODEL_PROMPT_INTERNAL_COMPONENT_MSG
    + `\ncontext: ${JSON.stringify(context)}`
    + `\nsummarize`;
const TOKEN_COUNT_LIMIT = strictParse.int(process.env.CONSOLIDATION_TOKEN_COUNT_LIMIT);

const consolidate = wrapper.logCorrelationId('service.consolidation.consolidate', async (correlationId, sessionId) => {
    log.log('consolidate: parameters', {correlationId, sessionId});
    const rawConsolidationRes = await memory.consolidate(correlationId, sessionId, async (lvl, raw) => {
        const start = new Date();
        // NB: strangely, in order of effectiveness: {text: summary} > summary > {summary}
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
        log.log('consolidate: context', {correlationId, sessionId, lvl, context});
        const prompt = MODEL_PROMPT(context);
        log.log('consolidate: prompt', {correlationId, sessionId, lvl, prompt});
        const startChat = new Date();
        const {content: summary} = await common.chatWithRetry(correlationId, prompt, TOKEN_COUNT_LIMIT, []);
        const elapsedChat = time.elapsedSecs(startChat);
        const {embedding: summaryEmbedding} = await common.embedWithRetry(correlationId, summary);
        const promptTokenCount = await tokenizer.countTokens(correlationId, prompt);
        const summaryTokenCount = await tokenizer.countTokens(correlationId, summary);
        const elapsed = time.elapsedSecs(start);
        const extra = {
            correlationId,
            context,
            tokenCounts: {
                prompt: promptTokenCount,
                summary: summaryTokenCount,
            },
            timeStats: {
                elapsed,
                elapsedChat,
            },
        };
        const dbExtra = {
            ...extra,
            prompt,
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
