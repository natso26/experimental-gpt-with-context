import log from './log.js';
import time from './time.js';
import error from './error.js';

const retry = (onError, fn) => async (...args) => {
    let cnt = 0;
    while (true) {
        try {
            return await fn(...args);
        } catch (e) {
            const isContinue = onError(e, cnt, ...args);
            if (!isContinue) {
                throw e;
            }
            cnt++;
        }
    }
};

const logCorrelationId = (name, fn) => async (correlationId, ...args) => {
    log.log(`[Start] ${name}`, {correlationId});
    const start = Date.now();
    try {
        const ret = await fn(correlationId, ...args);
        const elapsed = (Date.now() - start) / time.SECOND;
        log.log(`[Done] ${name}, elapsed: ${elapsed.toFixed(3)} s`, {correlationId, elapsed});
        return ret;
    } catch (e) {
        const elapsed = (Date.now() - start) / time.SECOND;
        log.log(`[Failed] ${name}, elapsed: ${elapsed.toFixed(3)} s`,
            {correlationId, elapsed, ...error.explain(e)});
        throw e;
    }
};

const cache = (cache, getKey, fn) => async (...args) => {
    const k = getKey(...args);
    let v = cache.get(k);
    if (v) {
        return v;
    } else {
        v = await fn(...args);
        cache.set(k, v);
        return v;
    }
};

const suppressError = (isSuppress, fn) => {
    const o = async (...args) => {
        try {
            return {v: await fn(...args)};
        } catch (e) {
            if (isSuppress(e)) {
                return {e};
            } else {
                throw e;
            }
        }
    };
    o.unwrap = ({v, e}) => {
        if (e) {
            throw e;
        } else {
            return v;
        }
    };
    return o;
};

export default {
    retry,
    logCorrelationId,
    cache,
    suppressError,
};
