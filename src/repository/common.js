import fetch_ from '../util/fetch.js';
import log from '../util/log.js';

const checkRespOk = async (correlationId, logFn, errorMsg, resp, cause = null) => {
    if (!resp.ok) {
        const msg = errorMsg(resp);
        const body = await fetch_.parseRespBody(resp);
        logFn(msg, {correlationId, body});
        const cause_ = cause?.(body);
        if (cause_) {
            throw new Error(msg, {cause: cause_});
        } else {
            throw new Error(msg);
        }
    }
};

const retryWithBackoff = async (correlationId, fn, backoff) => {
    let cnt = 0;
    while (true) {
        const resp = await fn();
        const backoff_ = backoff(cnt, resp);
        if (backoff_ === null) {
            return resp;
        }
        log.log(`retryWithBackoff: wait ${backoff_}ms`, {correlationId, backoff: backoff_});
        await new Promise((resolve) => setTimeout(resolve, backoff_));
        cnt++;
    }
};

export default {
    checkRespOk,
    retryWithBackoff,
};
