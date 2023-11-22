import log from './log.js';

const logCorrelationId = (name, fn) => async (correlationId, ...args) => {
    log.log(`[Start] ${name}`, {correlationId});
    const start = Date.now();
    try {
        const ret = await fn(correlationId, ...args);
        const elapsed = (Date.now() - start) / 1000;
        log.log(`[Done] ${name}, elapsed: ${elapsed.toFixed(3)} s`, {correlationId, elapsed});
        return ret;
    } catch (e) {
        const elapsed = (Date.now() - start) / 1000;
        log.log(`[Failed] ${name}, elapsed: ${elapsed.toFixed(3)} s`, {
            correlationId, elapsed,
            error: e.message || '', stack: e.stack || '',
        });
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

export default {
    logCorrelationId,
    cache,
};
