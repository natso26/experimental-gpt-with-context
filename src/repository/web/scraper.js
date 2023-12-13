import htmlParser from 'node-html-parser';
import common from '../common.js';
import common_ from '../../common.js';
import fetch_ from '../../util/fetch.js';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';

const URL = 'https://api.zenrows.com/v1';
const TIMEOUT = strictParse.int(process.env.ZENROWS_API_TIMEOUT_SECS) * 1000;
const WAIT = strictParse.int(process.env.ZENROWS_API_WAIT_MS);
const RETRY_429_BACKOFFS = strictParse.json(process.env.ZENROWS_API_RETRY_429_BACKOFFS_MS);

const extract = wrapper.logCorrelationId('repository.web.scraper.extract', async (correlationId, url) => {
    const resp = await common.retry429(correlationId, () => fetch_.withTimeout(`${URL}?${new URLSearchParams({
        apikey: common_.SECRETS.ZENROWS_API_KEY,
        js_render: 'true',
        wait: WAIT.toString(),
        url,
    })}`, {}, TIMEOUT), RETRY_429_BACKOFFS);
    await common.checkRespOk(correlationId, log.log, (resp) => `zenrows api error, status: ${resp.status}, url: ${url}`, resp);
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
});

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

export default {
    extract,
};
