import fetch_ from '../util/fetch.js';
import strictParse from '../util/strictParse.js';
import wrapper from '../util/wrapper.js';

const URL = 'https://serpapi.com/search';
const TIMEOUT = strictParse.int(process.env.SERPAPI_SEARCH_API_TIMEOUT_SECS) * 1000;

const search = wrapper.logCorrelationId('repository.serp.search', async (correlationId, query) => {
    const res = await fetch_.withTimeout(`${URL}?${new URLSearchParams({
        api_key: process.env.SERPAPI_API_KEY,
        engine: 'google',
        q: query,
    })}`, {}, TIMEOUT);
    if (!res.ok) {
        throw new Error(`serpapi search api error, status: ${res.status}`);
    }
    const rawData = await res.json();
    const unfilteredData = pruneRes(rawData);
    const {search_metadata, search_parameters, pagination, error, ...data} = unfilteredData;
    if (error) {
        return {
            data: null,
        };
    }
    return {
        data,
    };
});

const pruneRes = (data) => {
    if (Array.isArray(data)) {
        return data.map(pruneRes);
    } else if (typeof data === 'object') {
        const ret = {};
        Object.entries(data).forEach(([k, v]) => {
            if (k.includes('serpapi') || k === 'next_page_token') {
                return;
            }
            ret[k] = pruneRes(v);
        });
        return ret;
    } else if (typeof data === 'string') {
        if (data.startsWith('https://serpapi.com/') || data.startsWith('https://www.google.com/')) {
            return '';
        }
        return data;
    } else {
        return data;
    }
};

export default {
    search,
};
