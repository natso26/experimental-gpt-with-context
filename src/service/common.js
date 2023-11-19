import embedding from '../repository/embedding.js';
import chat from '../repository/chat.js';
import wolframAlpha from '../repository/wolframAlpha.js';
import strictParse from '../util/strictParse.js';
import log from '../util/log.js';

const QUERY_FIELD = 'query';
const QUERY_EMBEDDING_FIELD = 'queryEmbedding';
const REPLY_FIELD = 'reply';
const REPLY_EMBEDDING_FIELD = 'replyEmbedding';
const SUMMARY_FIELD = 'summary';
const SUMMARY_EMBEDDING_FIELD = 'summaryEmbedding';
const INTROSPECTION_FIELD = 'introspection';
const INTROSPECTION_EMBEDDING_FIELD = 'introspectionEmbedding';
const IMAGINATION_FIELD = 'imagination';
const IMAGINATION_EMBEDDING_FIELD = 'imaginationEmbedding';
const EMBED_RETRY_COUNT = strictParse.int(process.env.EMBED_REPOSITORY_RETRY_COUNT);
const CHAT_RETRY_COUNT = strictParse.int(process.env.CHAT_REPOSITORY_RETRY_COUNT);
const WOLFRAM_ALPHA_QUERY_RETRY_COUNT = strictParse.int(process.env.WOLFRAM_ALPHA_QUERY_REPOSITORY_RETRY_COUNT);

const cosineSimilarity = (a, b) => a.map((e, i) => e * b[i]).reduce((x, y) => x + y);

const retry = (fn, onError) => async (...args) => {
    let cnt = 0;
    while (true) {
        try {
            return await fn(...args);
        } catch (e) {
            const isContinue = onError(e, cnt);
            if (!isContinue) {
                throw e;
            }
            cnt++;
        }
    }
};

const embedWithRetry = retry(embedding.embed, (e, cnt) => {
    log.log(`embed repository failed, retry count: ${cnt}`, {
        cnt, error: e.message || '', stack: e.stack || '',
    });
    return cnt < EMBED_RETRY_COUNT;
});

const chatWithRetry = retry(chat.chat, (e, cnt) => {
    log.log(`chat repository failed, retry count: ${cnt}`, {
        cnt, error: e.message || '', stack: e.stack || '',
    });
    return cnt < CHAT_RETRY_COUNT;
});

const wolframAlphaQueryWithRetry = retry(wolframAlpha.query, (e, cnt) => {
    log.log(`wolfram alpha query repository failed, retry count: ${cnt}`, {
        cnt, error: e.message || '', stack: e.stack || '',
    });
    return cnt < WOLFRAM_ALPHA_QUERY_RETRY_COUNT;
});

export default {
    QUERY_FIELD,
    QUERY_EMBEDDING_FIELD,
    REPLY_FIELD,
    REPLY_EMBEDDING_FIELD,
    SUMMARY_FIELD,
    SUMMARY_EMBEDDING_FIELD,
    INTROSPECTION_FIELD,
    INTROSPECTION_EMBEDDING_FIELD,
    IMAGINATION_FIELD,
    IMAGINATION_EMBEDDING_FIELD,
    cosineSimilarity,
    embedWithRetry,
    chatWithRetry,
    wolframAlphaQueryWithRetry,
};
