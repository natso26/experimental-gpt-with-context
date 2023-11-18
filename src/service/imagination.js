import tokenizer from '../repository/tokenizer.js';
import memory from '../repository/memory.js';
import common from './common.js';
import strictParse from '../util/strictParse.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const MODEL_PROMPT_SCORE_FIELD = 'score';
const MODEL_PROMPT_TEXT_FIELD = 'text';
const MODEL_PROMPT = (context) =>
    `You are GPT. This is an internal system.`
    + `\nlong-term memory: ${JSON.stringify(context)}`
    + `\nthoughts`;
const CONTEXT_COUNT = strictParse.int(process.env.IMAGINATION_CONTEXT_COUNT);
const TOKEN_COUNT_LIMIT = strictParse.int(process.env.IMAGINATION_TOKEN_COUNT_LIMIT);

const imagine = wrapper.logCorrelationId('service.imagination.imagine', async (correlationId) => {
    log.log('imagination service parameters', {correlationId});
    const imagineRes = await memory.imagine(correlationId, new Date(), async (chatId) => {
        log.log(`imagination: imagine for chat ID ${chatId}`, {correlationId, chatId});
        const startTime = new Date();
        let selectedEmbedding;
        const rawContext = await memory.longTermSearch(correlationId, chatId, (getConsolidations, consolidation) => {
            if (!selectedEmbedding) {
                const cs = getConsolidations();
                const c = cs[Math.floor(Math.random() * cs.length)];
                const {
                    [common.SUMMARY_FIELD]: summary,
                    [common.IMAGINATION_FIELD]: imagination,
                } = c;
                log.log(`imagination: selected reference item for chat ID ${chatId}`,
                    {correlationId, chatId, summary, imagination});
                selectedEmbedding = c[common.SUMMARY_EMBEDDING_FIELD] || c[common.IMAGINATION_EMBEDDING_FIELD];
            }
            const targetEmbedding = consolidation[common.SUMMARY_EMBEDDING_FIELD] || consolidation[common.IMAGINATION_EMBEDDING_FIELD];
            return common.cosineSimilarity(selectedEmbedding, targetEmbedding);
        }, CONTEXT_COUNT);
        if (!rawContext.length) {
            log.log(`imagination: chat ID ${chatId} has yet no long-term memory; do not perform imagination`,
                {correlationId, chatId});
            return {
                imagination: null,
            };
        }
        // NB: summary and imagination are not distinguished
        const context = rawContext.map(([{
            [common.SUMMARY_FIELD]: summary,
            [common.IMAGINATION_FIELD]: imagination,
        }, rawScore]) => {
            const score = parseFloat(rawScore.toFixed(3));
            return {
                [MODEL_PROMPT_SCORE_FIELD]: score,
                [MODEL_PROMPT_TEXT_FIELD]: !imagination ? summary : imagination,
            };
        });
        log.log(`imagination context for chat ID ${chatId}`, {correlationId, chatId, context});
        const prompt = MODEL_PROMPT(context);
        log.log('imagination prompt', {correlationId, chatId, prompt});
        const startChatTime = new Date();
        const {content: imagination} = await common.chatWithRetry(correlationId, prompt, TOKEN_COUNT_LIMIT, []);
        const endChatTime = new Date();
        const {embedding: imaginationEmbedding} = await common.embedWithRetry(correlationId, imagination);
        const promptTokenCount = await tokenizer.countTokens(correlationId, prompt);
        const imaginationTokenCount = await tokenizer.countTokens(correlationId, imagination);
        const endTime = new Date();
        const extra = {
            correlationId,
            context,
            prompt,
            tokenCounts: {
                prompt: promptTokenCount,
                imagination: imaginationTokenCount,
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
        const {index, timestamp} = await memory.addImagination(correlationId, chatId, {
            [common.IMAGINATION_FIELD]: imagination,
            [common.IMAGINATION_EMBEDDING_FIELD]: imaginationEmbedding,
        }, extra);
        return {
            index,
            timestamp,
            imagination,
            ...extra,
        };
    });
    return {
        imagineRes,
    };
});

export default {
    imagine,
};
