import fetch_ from '../util/fetch.js';
import log from '../util/log.js';

const checkRespOk = async (correlationId, logFn, errorMsg, resp) => {
    if (!resp.ok) {
        const msg = errorMsg(resp);
        const body = await fetch_.parseRespBody(resp);
        logFn(msg, {correlationId, body});
        throw new Error(msg);
    }
};

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
    checkRespOk,
    retry429,
};
