import log from './log.js';

const logCorrelationId = (name, fn) => {
    return async (correlationId, ...args) => {
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
};

export default {logCorrelationId};
