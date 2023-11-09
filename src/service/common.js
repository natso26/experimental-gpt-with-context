import embedding from '../repository/embedding.js';
import chat from '../repository/chat.js';
import log from '../util/log.js';

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
}

const embedWithRetry = retry(embedding.embed, (e, cnt) => {
    log.log(`embeddings failed, retry count: ${cnt}`, {
        cnt, error: e.message || '', stack: e.stack || '',
    });
    return cnt < 3;
});

const chatWithRetry = retry(chat.chat, (e, cnt) => {
    log.log(`chat completions failed, retry count: ${cnt}`, {
        cnt, error: e.message || '', stack: e.stack || '',
    });
    return cnt < 3;
});

export default {cosineSimilarity, retry, embedWithRetry, chatWithRetry};
