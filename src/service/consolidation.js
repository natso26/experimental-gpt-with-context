import memory from '../repository/memory.js';
import common from './common.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';
import tokenizer from "../repository/tokenizer.js";

const TOKEN_COUNT_LIMIT = parseInt(process.env.CONSOLIDATION_TOKEN_COUNT_LIMIT);

const consolidate = wrapper.logCorrelationId('service.consolidation.consolidate', async (correlationId, chatId) => {
    log.log('consolidation service parameters', {correlationId, chatId});
    const rawConsolidationRes = await memory.consolidate(correlationId, chatId, async (lvl, raw) => {
        // NB: it is better to flatten to summary instead of saying {summary}, but not with other cases
        const context = lvl ? raw.map((
                {
                    [common.SUMMARY_FIELD]: summary,
                }) => summary)
            : raw.map((
                {
                    [common.QUESTION_FIELD]: question,
                    [common.REPLY_FIELD]: reply,
                    [common.INTROSPECTION_FIELD]: introspection,
                }) => !introspection ? {question, reply} : {introspection});
        log.log('consolidation context', {correlationId, chatId, lvl, context});
        const prompt = chatPrompt(context);
        log.log('consolidation prompt', {correlationId, chatId, prompt});
        const {content: summary} = await common.chatWithRetry(correlationId, prompt, TOKEN_COUNT_LIMIT, []);
        const {embedding: summaryEmbedding} = await common.embedWithRetry(correlationId, summary);
        const promptTokenCount = await tokenizer.countTokens(correlationId, prompt);
        const summaryTokenCount = await tokenizer.countTokens(correlationId, summary);
        return {
            consolidation: {
                [common.SUMMARY_FIELD]: summary,
                [common.SUMMARY_EMBEDDING_FIELD]: summaryEmbedding,
            },
            extra: {
                context,
                prompt,
                promptTokenCount,
                summaryTokenCount,
            },
        };
    });
    const consolidationRes = rawConsolidationRes.map(({lvl, index, timestamp, consolidation, extra}) => {
        const {
            [common.SUMMARY_FIELD]: summary,
        } = consolidation;
        const {context, prompt, promptTokenCount, summaryTokenCount} = extra;
        return {
            lvl,
            index,
            timestamp,
            summary,
            context,
            prompt,
            promptTokenCount,
            summaryTokenCount,
        };
    });
    return {
        consolidationRes,
    };
});

const chatPrompt = (context) =>
    `You are GPT. This is an internal system.\n`
    + `${JSON.stringify(context)}\n`
    + `summarize`;

export default {consolidate};
