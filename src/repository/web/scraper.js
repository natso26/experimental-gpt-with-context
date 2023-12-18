import htmlParser from 'node-html-parser';
import common from '../common.js';
import common_ from '../../common.js';
import fetch_ from '../../util/fetch.js';
import cache from '../../util/cache.js';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';
import time from '../../util/time.js';

const URL = 'https://api.zenrows.com/v1';
const TIMEOUT = strictParse.int(process.env.ZENROWS_API_TIMEOUT_SECS) * time.SECOND;
const WAIT = strictParse.int(process.env.ZENROWS_API_WAIT_MS);
const RETRY_429_BACKOFFS = strictParse.json(process.env.ZENROWS_API_RETRY_429_BACKOFFS_MS);
const RETRY_403_BACKOFFS = strictParse.json(process.env.ZENROWS_API_RETRY_403_BACKOFFS_MS);

const extract = (() => {
    const f = wrapper.suppressError((e) => e.cause?.noRetry,
        wrapper.logCorrelationId('repository.web.scraper.extract', async (correlationId, url) => {
            if (url.endsWith('.pdf')) {
                throw new Error(`scraper: not support pdf files: ${url}`, {cause: {noRetry: true}});
            }
            const resp = await common.retryWithBackoff(correlationId, () => fetch_.withTimeout(`${URL}?${new URLSearchParams({
                apikey: common_.SECRETS.ZENROWS_API_KEY,
                js_render: 'true',
                wait: WAIT.toString(),
                url,
            })}`, {}, TIMEOUT), backoff);
            await common.checkRespOk(correlationId, log.log, (resp) => `zenrows api error, status: ${resp.status}, url: ${url}`, resp, errorCause);
            const rawData = await resp.text();
            const root = htmlParser.parse(rawData, {
                blockTextElements: {
                    script: false,
                    noscript: false,
                    style: false,
                },
            }).removeWhitespace();
            const textData = readTexts(root);
            return {
                textData,
            };
        }));
    const g = wrapper.cache(cache.lruTtl(100, 5 * time.MINUTE), (correlationId, url) => url, f);
    return (...args) => g(...args).then(f.unwrap);
})();

const errorCause = (() => {
    // https://www.zenrows.com/docs/api-error-codes
    const CODES = ['REQS001', 'REQS002', 'RESP001', 'RESP002', 'RESP005'];
    return (body) => {
        if (CODES.includes(body.code)) return {noRetry: true};
        else return null;
    };
})();

const readTexts = (node) => {
    if (node.nodeType === 3) { // text
        return node.text.trim() || null;
    }
    const texts = node.childNodes.map(readTexts).filter((v) => v);
    if (!texts.length) {
        return null;
    } else if (texts.length === 1) {
        return texts[0];
    } else {
        return texts;
    }
};

const backoff = (cnt, resp) => {
    if (![429, 403].includes(resp.status)) return null;
    else {
        const backoffs = resp.status === 429 ? RETRY_429_BACKOFFS : RETRY_403_BACKOFFS;
        if (cnt >= backoffs.length) return null;
        else return backoffs[cnt];
    }
};

export default {
    extract,
};
