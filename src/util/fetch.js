const withTimeout = async (url, options, timeout) => {
    const controller = new AbortController();
    const {abort, signal} = controller;
    // JS weirdness requires binding, or () => controller.abort()
    // FYI this is just for studies; there is no need to obsess over
    // these detailed details, but it may be useful to know
    // that the abort controller can break this way for anyone who
    // is here
    const timeoutId = setTimeout(abort.bind(controller), timeout);
    try {
        return await fetch(url, {...options, signal});
    } finally {
        clearTimeout(timeoutId);
    }
};

export default {withTimeout};
