import tokenizer from '../repository/tokenizer.js';
import memory from '../repository/memory.js';
import common from './common.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const MIN_WAIT_TIME = parseInt(process.env.INTROSPECTION_MIN_WAIT_TIME_SECS) * 1000;
const MAX_WAIT_TIME = parseInt(process.env.INTROSPECTION_MAX_WAIT_TIME_SECS) * 1000;
const CONTEXT_COUNT = parseInt(process.env.INTROSPECTION_CONTEXT_COUNT);
const TOKEN_COUNT_LIMIT = parseInt(process.env.INTROSPECTION_TOKEN_COUNT_LIMIT);

const introspect = wrapper.logCorrelationId('service.introspection.introspect', async (correlationId, chatId, index) => {
    log.log('introspection service parameters', {correlationId, chatId, index});
    const waitTime = Math.exp(Math.log(MIN_WAIT_TIME)
        + Math.random() * (Math.log(MAX_WAIT_TIME) - Math.log(MIN_WAIT_TIME)));
    log.log('introspection wait time', {correlationId, chatId, waitTime});
    await new Promise(resolve => setTimeout(resolve, waitTime));
    // NB: since introspection can interleave with (question, reply) at most 1:1,
    // we need to double the search range
    const {elts: rawContext, latestIndex} = await memory.getLatest(correlationId, chatId, 2 * CONTEXT_COUNT);
    if (latestIndex !== index) {
        log.log(`introspection: index outdated; do nothing: ${index} < ${latestIndex}`,
            {correlationId, index, latestIndex});
        return {
            introspection: null,
        };
    }
    const context = rawContext.filter(({[common.INTROSPECTION_FIELD]: introspection}) => !introspection)
        .slice(-CONTEXT_COUNT).map((
            {
                [common.QUESTION_FIELD]: question,
                [common.REPLY_FIELD]: reply,
            }) => ({question, reply}));
    log.log('introspection context', {correlationId, chatId, context});
    const prompt = chatPrompt(context);
    log.log('introspection prompt', {correlationId, chatId, prompt});
    const {content: introspection} = await common.chatWithRetry(correlationId, prompt, TOKEN_COUNT_LIMIT, []);
    const {embedding: introspectionEmbedding} = await common.embedWithRetry(correlationId, introspection);
    const promptTokenCount = await tokenizer.countTokens(correlationId, prompt);
    const introspectionTokenCount = await tokenizer.countTokens(correlationId, introspection);
    const {index: introspectionIndex, timestamp} = await memory.add(correlationId, chatId, {
        [common.INTROSPECTION_FIELD]: introspection,
        [common.INTROSPECTION_EMBEDDING_FIELD]: introspectionEmbedding,
    }, {
        waitTime,
        context,
        prompt,
        promptTokenCount,
        introspectionTokenCount,
    }, true);
    return {
        index: introspectionIndex,
        timestamp,
        introspection,
        waitTime,
        context,
        prompt,
        promptTokenCount,
        introspectionTokenCount,
    };
});

const chatPrompt = (context) =>
    `You are GPT. This is an internal system.\n`
    + `short-term memory: ${JSON.stringify(context)}\n`
    + `thoughts`;

export default {introspect};
