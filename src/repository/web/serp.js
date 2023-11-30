import common_ from '../../common.js';
import fetch_ from '../../util/fetch.js';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';

const URL = 'https://serpapi.com/search';
const TIMEOUT = strictParse.int(process.env.SERPAPI_SEARCH_API_TIMEOUT_SECS) * 1000;

const search = wrapper.logCorrelationId('repository.web.serp.search', async (correlationId, query) => {
    const resp = await fetch_.withTimeout(`${URL}?${new URLSearchParams({
        api_key: common_.SECRETS.SERPAPI_API_KEY,
        engine: 'google',
        q: query,
    })}`, {}, TIMEOUT);
    if (!resp.ok) {
        const msg = `serpapi search api error, status: ${resp.status}`;
        const body = await fetch_.parseRespBody(resp);
        log.log(msg, {correlationId, body});
        throw new Error(msg);
    }
    const rawData = await resp.json();
    const unfilteredData = pruneResp(rawData);
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

const getOrganicLinks = (data) => {
    const {organic_results: rawOrganicResults} = data;
    const organicResults = rawOrganicResults || [];
    return organicResults.map(({link}) => link);
};

const pruneResp = (data) => {
    if (Array.isArray(data)) {
        return data.map(pruneResp);
    } else if (typeof data === 'object') {
        const ret = {};
        Object.entries(data).forEach(([k, v]) => {
            if (k.includes('serpapi') || k === 'next_page_token') {
                return;
            }
            ret[k] = pruneResp(v);
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
    getOrganicLinks,
};
