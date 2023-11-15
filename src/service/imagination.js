import memory from '../repository/memory.js';
import common from './common.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';
import tokenizer from "../repository/tokenizer.js";

const CONTEXT_COUNT = parseInt(process.env.IMAGINATION_CONTEXT_COUNT);
const TOKEN_COUNT_LIMIT = parseInt(process.env.IMAGINATION_TOKEN_COUNT_LIMIT);

const imagine = wrapper.logCorrelationId('service.imagination.imagine', async (correlationId) => {
    log.log('imagination service parameters', {correlationId});
    const refTime = new Date();
    log.log('imagination reference time', {correlationId, refTime});
    const imagineRes = await memory.imagine(correlationId, refTime, async (chatId) => {
        log.log(`imagination: imagine for chat ID ${chatId}`, {correlationId, chatId});
        let referenceEmbedding;
        const rawContext = await memory.longTermSearch(correlationId, chatId, (getConsolidations, consolidation) => {
            if (!referenceEmbedding) {
                const cs = getConsolidations();
                const c = cs[Math.floor(Math.random() * cs.length)];
                const {
                    [common.SUMMARY_FIELD]: summary,
                    [common.IMAGINATION_FIELD]: imagination,
                } = c;
                log.log(`imagination: selected reference item for chat ID ${chatId}`,
                    {correlationId, chatId, summary, imagination});
                referenceEmbedding = c[common.SUMMARY_EMBEDDING_FIELD] || c[common.IMAGINATION_EMBEDDING_FIELD];
            }
            const targetEmbedding = consolidation[common.SUMMARY_EMBEDDING_FIELD] || consolidation[common.IMAGINATION_EMBEDDING_FIELD];
            return common.cosineSimilarity(referenceEmbedding, targetEmbedding);
        }, CONTEXT_COUNT);
        if (!rawContext.length) {
            log.log(`imagination: chat ID ${chatId} has yet no long-term memory; do not perform imagination`,
                {correlationId, chatId});
            return {
                imagination: null,
            };
        }
        // NB: intentionally, summary and imagination cannot be distinguished
        const context = rawContext.map(([{
            [common.SUMMARY_FIELD]: summary,
            [common.IMAGINATION_FIELD]: imagination,
        },]) =>
            !imagination ? summary : imagination);
        log.log(`imagination context for chat ID ${chatId}`, {correlationId, chatId, context});
        const prompt = chatPrompt(context);
        log.log('imagination prompt', {correlationId, chatId, prompt});
        const {content: imagination} = await common.chatWithRetry(correlationId, prompt, TOKEN_COUNT_LIMIT, []);
        const {embedding: imaginationEmbedding} = await common.embedWithRetry(correlationId, imagination);
        const promptTokenCount = await tokenizer.countTokens(correlationId, prompt);
        const imaginationTokenCount = await tokenizer.countTokens(correlationId, imagination);
        const {index, timestamp} = await memory.addImagination(correlationId, chatId, {
            [common.IMAGINATION_FIELD]: imagination,
            [common.IMAGINATION_EMBEDDING_FIELD]: imaginationEmbedding,
        }, {
            context,
            prompt,
            promptTokenCount,
            imaginationTokenCount,
        });
        return {
            index,
            timestamp,
            imagination,
            context,
            prompt,
            promptTokenCount,
            imaginationTokenCount,
        };
    });
    return {
        refTime,
        imagineRes,
    };
});

const chatPrompt = (context) =>
    `You are GPT. This is an internal system.\n`
    + `long-term memory: ${JSON.stringify(context)}\n`
    + `thoughts`;

export default {imagine};
