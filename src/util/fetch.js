// NB: built-in fetch cannot go on for longer than 5 minutes no matter the timeout set
import fetch_ from 'node-fetch';

const withTimeout = async (url, options, timeout) => {
    const controller = new AbortController();
    const {abort, signal} = controller;
    const timeoutId = setTimeout(abort.bind(controller), timeout);
    try {
        return await fetch_(url, {...options, signal});
    } finally {
        clearTimeout(timeoutId);
    }
};

export default {
    withTimeout,
};
