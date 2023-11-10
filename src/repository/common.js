const fetchWithTimeout = async (url, options, timeout) => {
    const {signal, abort} = new AbortController();
    const timeoutId = setTimeout(abort, timeout);
    try {
        return await fetch(url, {...options, signal});
    } finally {
        clearTimeout(timeoutId);
    }
};

export default {fetchWithTimeout};
