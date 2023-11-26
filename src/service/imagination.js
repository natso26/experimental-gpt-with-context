import tokenizer from '../repository/tokenizer.js';
import memory from '../repository/memory.js';
import common from './common.js';
import strictParse from '../util/strictParse.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';
import time from '../util/time.js';

const MODEL_PROMPT_SCORE_FIELD = 'score';
const MODEL_PROMPT_TEXT_FIELD = 'text';
const MODEL_PROMPT = (context) =>
    common.MODEL_PROMPT_INTERNAL_COMPONENT_MSG
    + `\ncontext: ${JSON.stringify(context)}`
    + `\nthoughts`;
const CONTEXT_SCORE = (rand, sim) => {
    return Math.exp(rand * Math.log(sim));
};
const CONTEXT_COUNT = strictParse.int(process.env.IMAGINATION_CONTEXT_COUNT);
const TOKEN_COUNT_LIMIT = strictParse.int(process.env.IMAGINATION_TOKEN_COUNT_LIMIT);

const imagine = wrapper.logCorrelationId('service.imagination.imagine', async (correlationId) => {
    log.log('imagine: parameters', {correlationId});
    const imagineRes = await memory.imagine(correlationId, new Date(), async (docId) => {
        log.log(`imagine: imagine for doc ID ${docId}`, {correlationId, docId});
        const start = new Date();
        let selectedEmbedding;
        const rawContext = await memory.longTermSearch(correlationId, docId, (getConsolidations, consolidation) => {
            if (!selectedEmbedding) {
                const cs = getConsolidations();
                const c = cs[Math.floor(Math.random() * cs.length)];
                const {
                    [common.SUMMARY_FIELD]: summary,
                    [common.IMAGINATION_FIELD]: imagination,
                } = c;
                log.log(`imagine: selected reference item for doc ID ${docId}`,
                    {correlationId, docId, summary, imagination});
                selectedEmbedding = c[common.SUMMARY_EMBEDDING_FIELD] || c[common.IMAGINATION_EMBEDDING_FIELD];
            }
            const rand = Math.random();
            const targetEmbedding = consolidation[common.SUMMARY_EMBEDDING_FIELD] || consolidation[common.IMAGINATION_EMBEDDING_FIELD];
            const sim = common.absCosineSimilarity(selectedEmbedding, targetEmbedding);
            return CONTEXT_SCORE(rand, sim);
        }, CONTEXT_COUNT);
        if (!rawContext.length) {
            log.log(`imagine: doc ID ${docId} has yet no long-term memory; do not perform imagination`,
                {correlationId, docId});
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
        log.log(`imagine: context for doc ID ${docId}`, {correlationId, docId, context});
        const prompt = MODEL_PROMPT(context);
        log.log('imagine: prompt', {correlationId, docId, prompt});
        const startChat = new Date();
        const {content: imagination} = await common.chatWithRetry(correlationId, prompt, TOKEN_COUNT_LIMIT, null);
        const elapsedChat = time.elapsedSecs(startChat);
        const {embedding: imaginationEmbedding} = await common.embedWithRetry(correlationId, imagination);
        const promptTokenCount = await tokenizer.countTokens(correlationId, prompt);
        const imaginationTokenCount = await tokenizer.countTokens(correlationId, imagination);
        const elapsed = time.elapsedSecs(start);
        const extra = {
            correlationId,
            context,
            prompt,
            tokenCounts: {
                prompt: promptTokenCount,
                imagination: imaginationTokenCount,
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
        const {index, timestamp} = await memory.addImagination(correlationId, docId, {
            [common.IMAGINATION_FIELD]: imagination,
            [common.IMAGINATION_EMBEDDING_FIELD]: imaginationEmbedding,
        }, dbExtra);
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
