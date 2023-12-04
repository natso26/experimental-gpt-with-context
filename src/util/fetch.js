// NB: built-in fetch cannot go on for longer than 5 minutes no matter the timeout set
import fetch_ from 'node-fetch';

const withTimeout = async (url, options, timeout) => {
    const controller = new AbortController();
    const {abort: abort_, signal: signal_} = controller;
    const abort = abort_.bind(controller);
    const signal = !options.signal ? signal_ : anySignal([signal_, options.signal]);
    const timeoutId = setTimeout(abort, timeout);
    try {
        return await fetch_(url, {...options, signal});
    } finally {
        clearTimeout(timeoutId);
    }
};

// CR: https://github.com/whatwg/fetch/issues/905
const anySignal = (signals) => {
    const controller = new AbortController();
    const {abort: abort_, signal} = controller;
    const abort = abort_.bind(controller);
    for (const s of signals) {
        if (s.aborted) {
            abort(s.reason);
            break;
        }
        s.addEventListener('abort', () => abort(s.reason), {signal});
    }
    return signal;
};

const parseRespBody = async (resp) => {
    const body = await resp.json().catch((_) => resp.text());
    return body;
};

export default {
    withTimeout,
    parseRespBody,
};
