import common from '../common.js';
import common_ from '../../common.js';
import fetch_ from '../../util/fetch.js';
import cache from '../../util/cache.js';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';

const LOCATIONS_URL = 'https://serpapi.com/locations.json';
const SEARCH_URL = 'https://serpapi.com/search';
const TIMEOUT = strictParse.int(process.env.SERPAPI_SEARCH_API_TIMEOUT_SECS) * 1000;

const getLocations = wrapper.cache(cache.lruTtl(1, 60 * 60 * 1000), (correlationId, callback) => '',
    wrapper.logCorrelationId('repository.web.serp.getLocations', async (correlationId, callback) => {
        const resp = await wrapper.retry((e, cnt) => cnt < 3, async (...args) => {
            const resp = await fetch_.withTimeout(...args);
            await common.checkRespOk(correlationId, log.log, (resp) => `serapi locations api error, status: ${resp.status}`, resp);
            return resp;
        })(LOCATIONS_URL, {}, 30 * 1000);
        const locations_ = await resp.json();
        const locations = locations_.map(({canonical_name, target_type, reach, gps}) =>
            ({canonicalName: canonical_name, targetType: target_type, reach, lat: gps?.[1], lon: gps?.[0]}))
            .filter(({reach, lat, lon}) => reach !== undefined && lat !== undefined && lon !== undefined);
        const l = locations.length;
        log.log(`serpapi locations api: data, length ${l}`, {correlationId, l});
        await callback(correlationId, locations);
        return locations;
    }));

const search = wrapper.logCorrelationId('repository.web.serp.search', async (correlationId, query, location) => {
    const resp = await fetch_.withTimeout(`${SEARCH_URL}?${new URLSearchParams({
        api_key: common_.SECRETS.SERPAPI_API_KEY,
        engine: 'google',
        q: query,
        ...(!location ? {} : {location}),
    })}`, {}, TIMEOUT);
    await common.checkRespOk(correlationId, log.log, (resp) => `serpapi search api error, status: ${resp.status}, query: ${query}`, resp);
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
    } else if (data !== null && typeof data === 'object') {
        const ret = {};
        for (const [k, v] of Object.entries(data)) {
            if (k.includes('serpapi') || k === 'next_page_token') {
                continue;
            }
            ret[k] = pruneResp(v);
        }
        return ret;
    } else if (typeof data === 'string') {
        if (data.startsWith('https://serpapi.com/') || data.startsWith('https://www.google.com/')) {
            return '';
        } else {
            return data;
        }
    } else {
        return data;
    }
};

export default {
    getLocations,
    search,
    getOrganicLinks,
};
