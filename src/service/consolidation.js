import memory from '../repository/memory.js';
import common from './common.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';
import tokenizer from "../repository/tokenizer.js";

const MODEL_PROMPT_QUERY_FIELD = 'query';
const MODEL_PROMPT_REPLY_FIELD = 'reply';
const MODEL_PROMPT_INTROSPECTION_FIELD = 'introspection';
const MODEL_PROMPT_TEXT_FIELD = 'text';
const MODEL_PROMPT = (context) =>
    `You are GPT. This is an internal system.`
    + `\n${JSON.stringify(context)}`
    + `\nsummarize`;
const TOKEN_COUNT_LIMIT = parseInt(process.env.CONSOLIDATION_TOKEN_COUNT_LIMIT);

const consolidate = wrapper.logCorrelationId('service.consolidation.consolidate', async (correlationId, chatId) => {
    log.log('consolidation service parameters', {correlationId, chatId});
    const rawConsolidationRes = await memory.consolidate(correlationId, chatId, async (lvl, raw) => {
        const startTime = new Date();
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
        log.log('consolidation context', {correlationId, chatId, lvl, context});
        const prompt = MODEL_PROMPT(context);
        log.log('consolidation prompt', {correlationId, chatId, prompt});
        const startChatTime = new Date();
        const {content: summary} = await common.chatWithRetry(correlationId, prompt, TOKEN_COUNT_LIMIT, []);
        const endChatTime = new Date();
        const {embedding: summaryEmbedding} = await common.embedWithRetry(correlationId, summary);
        const promptTokenCount = await tokenizer.countTokens(correlationId, prompt);
        const summaryTokenCount = await tokenizer.countTokens(correlationId, summary);
        const endTime = new Date();
        const extra = {
            correlationId,
            context,
            prompt,
            tokenCounts: {
                prompt: promptTokenCount,
                summary: summaryTokenCount,
            },
            timeStats: {
                elapsed: endTime - startTime,
                elapsedChat: endChatTime - startChatTime,
                startTime,
                startChatTime,
                endChatTime,
                endTime,
            },
        };
        return {
            consolidation: {
                [common.SUMMARY_FIELD]: summary,
                [common.SUMMARY_EMBEDDING_FIELD]: summaryEmbedding,
            }, extra,
        };
    });
    const consolidationRes = rawConsolidationRes.map(({lvl, index, timestamp, consolidation, extra}) => {
        const {
            [common.SUMMARY_FIELD]: summary,
        } = consolidation;
        return {
            lvl,
            index,
            timestamp,
            summary,
            ...extra,
        };
    });
    return {
        consolidationRes,
    };
});

export default {
    consolidate,
};
