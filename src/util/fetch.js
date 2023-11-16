const withTimeout = async (url, options, timeout) => {
    const controller = new AbortController();
    const {abort, signal} = controller;
    const timeoutId = setTimeout(abort.bind(controller), timeout);
    try {
        return await fetch(url, {...options, signal});
    } finally {
        clearTimeout(timeoutId);
    }
};

export default {
    withTimeout,
};
