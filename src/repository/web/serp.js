import common from '../common.js';
import common_ from '../../common.js';
import fetch_ from '../../util/fetch.js';
import cache from '../../util/cache.js';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';
import time from '../../util/time.js';

const LOCATIONS_URL = 'https://serpapi.com/locations.json';
const SEARCH_URL = 'https://serpapi.com/search';
const TIMEOUT = strictParse.int(process.env.SERPAPI_SEARCH_API_TIMEOUT_SECS) * time.SECOND;

const getLocations = wrapper.cache(cache.lruTtl(1, time.HOUR), (correlationId, callback) => '',
    wrapper.logCorrelationId('repository.web.serp.getLocations', async (correlationId, callback) => {
        const resp = await wrapper.retry((e, cnt) => cnt < 3, async (...args) => {
            const resp = await fetch_.withTimeout(...args);
            await common.checkRespOk(correlationId, log.log, (resp) => `serapi locations api error, status: ${resp.status}`, resp);
            return resp;
        })(LOCATIONS_URL, {}, 30 * time.SECOND);
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
        hl: 'en',
        ...(!location ? {} : {location}),
    })}`, {}, TIMEOUT);
    await common.checkRespOk(correlationId, log.log, (resp) => `serpapi search api error, status: ${resp.status}, query: ${query}`, resp);
    const rawData = await resp.json();
    if (rawData.error) {
        return {
            data: null,
        };
    }
    const data = pruneResp(rawData);
    return {
        data,
    };
});

const getOrganicLinks = (data) => {
    const {organic_results: rawOrganicResults} = data;
    const organicResults = rawOrganicResults || [];
    return organicResults.map(({link}) => link);
};

const pruneResp = (() => {
    const EXCLUDE_KEYS = ['place_id', 'lsig', 'chips', 'position', 'block_position', 'cached_page_link', 'related_pages_link'];
    const EXCLUDE_STR_PREFIXES = ['https://serpapi.com/', 'https://www.google.com/search', 'https://webcache.googleusercontent.com/search'];
    const EXCLUDE_STR_GSTATIC_REGEXP = /^https:\/\/[a-z0-9\-]+\.gstatic\.com\//;
    const pruneArr = (arr) => arr.map(pruneAny);
    const pruneObj = (obj) => {
        const o = {};
        for (const [k, v] of Object.entries(obj)) {
            if (k.includes('serpapi') || EXCLUDE_KEYS.includes(k) || k.endsWith('page_token')) continue;
            o[k] = pruneAny(v);
        }
        return o;
    };
    const pruneStr = (str) => {
        for (const s of EXCLUDE_STR_PREFIXES) if (str.startsWith(s)) return '';
        if (EXCLUDE_STR_GSTATIC_REGEXP.test(str)) return '';
        return str;
    };
    const pruneAny = (v) => {
        if (Array.isArray(v)) return pruneArr(v);
        else if (v !== null && typeof v === 'object') return pruneObj(v);
        else if (typeof v === 'string') return pruneStr(v);
        else return v;
    };
    return (v) => {
        const {
            search_metadata, search_parameters, search_information: {organic_results_state} = {},
            pagination, serpapi_pagination, error, ...rest
        } = v;
        return {search_information: {organic_results_state}, ...pruneObj(rest)};
    };
})();

export default {
    getLocations,
    search,
    getOrganicLinks,
};
