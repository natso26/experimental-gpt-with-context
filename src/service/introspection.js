import tokenizer from '../repository/tokenizer.js';
import memory from '../repository/memory.js';
import common from './common.js';
import strictParse from '../util/strictParse.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';
import time from '../util/time.js';

const MODEL_PROMPT_QUERY_FIELD = 'query';
const MODEL_PROMPT_REPLY_FIELD = 'reply';
const MODEL_PROMPT = (context) =>
    common.MODEL_PROMPT_INTERNAL_COMPONENT_MSG
    + `\ncontext: ${JSON.stringify(context)}`
    + `\nanalyze`;
const MIN_WAIT_TIME = strictParse.int(process.env.INTROSPECTION_MIN_WAIT_TIME_SECS) * 1000;
const MAX_WAIT_TIME = strictParse.int(process.env.INTROSPECTION_MAX_WAIT_TIME_SECS) * 1000;
const CONTEXT_COUNT = strictParse.int(process.env.INTROSPECTION_CONTEXT_COUNT);
const TOKEN_COUNT_LIMIT = strictParse.int(process.env.INTROSPECTION_TOKEN_COUNT_LIMIT);

const introspect = wrapper.logCorrelationId('service.introspection.introspect', async (correlationId, userId, sessionId, index) => {
    log.log('introspect: parameters', {correlationId, userId, sessionId, index});
    const docId = common.DOC_ID.from(userId, sessionId);
    const waitTime = Math.exp(Math.log(MIN_WAIT_TIME)
        + Math.random() * (Math.log(MAX_WAIT_TIME) - Math.log(MIN_WAIT_TIME)));
    log.log('introspect: wait time', {correlationId, docId, waitTime});
    await new Promise(resolve => setTimeout(resolve, waitTime));
    const start = new Date();
    // NB: since introspection can interleave with (query, reply) at at most 1:1, we double the search range
    const {elts: rawContext, latestIndex} = await memory.getLatest(correlationId, docId, 2 * CONTEXT_COUNT);
    if (latestIndex !== index) {
        log.log(`introspect: index outdated; do nothing: ${index} < ${latestIndex}`,
            {correlationId, index, latestIndex});
        return {
            introspection: null,
        };
    }
    const context = rawContext.filter(({[common.INTROSPECTION_FIELD]: introspection}) => !introspection)
        .slice(-CONTEXT_COUNT).map((
            {
                [common.QUERY_FIELD]: query,
                [common.REPLY_FIELD]: reply,
            }) => ({
            [MODEL_PROMPT_QUERY_FIELD]: query,
            [MODEL_PROMPT_REPLY_FIELD]: reply,
        }));
    log.log('introspect: context', {correlationId, docId, context});
    const prompt = MODEL_PROMPT(context);
    log.log('introspect: prompt', {correlationId, docId, prompt});
    const startChat = new Date();
    const {content: introspection} = await common.chatWithRetry(correlationId, prompt, TOKEN_COUNT_LIMIT, null);
    const elapsedChat = time.elapsedSecs(startChat);
    const {embedding: introspectionEmbedding} = await common.embedWithRetry(correlationId, introspection);
    const promptTokenCount = await tokenizer.countTokens(correlationId, prompt);
    const introspectionTokenCount = await tokenizer.countTokens(correlationId, introspection);
    const elapsed = time.elapsedSecs(start);
    const extra = {
        correlationId,
        inputIndex: index,
        waitTime,
        context,
        tokenCounts: {
            prompt: promptTokenCount,
            introspection: introspectionTokenCount,
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
    const {index: introspectionIndex, timestamp} = await memory.add(correlationId, docId, {
        [common.INTROSPECTION_FIELD]: introspection,
        [common.INTROSPECTION_EMBEDDING_FIELD]: introspectionEmbedding,
    }, dbExtra, true);
    return {
        index: introspectionIndex,
        timestamp,
        introspection,
        ...extra,
    };
});

export default {
    introspect,
};
