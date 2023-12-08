import log from '../util/log.js';

const retry429 = async (correlationId, fn, backoffs) => {
    for (const backoff of backoffs) {
        const resp = await fn();
        if (resp.status !== 429) {
            return resp;
        }
        log.log(`retry429: wait ${backoff}ms`, {correlationId, backoff});
        await new Promise((resolve) => setTimeout(resolve, backoff));
    }
    return await fn();
};

export default {
    retry429,
};
