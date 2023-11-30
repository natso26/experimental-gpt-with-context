import common_ from '../../common.js';
import fetch_ from '../../util/fetch.js';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';

const URL = 'https://api.wolframalpha.com/v2/query';
const TIMEOUT = strictParse.int(process.env.WOLFRAM_ALPHA_QUERY_API_TIMEOUT_SECS) * 1000;

const query = wrapper.logCorrelationId('repository.web.wolframAlpha.query', async (correlationId, query) => {
    const resp = await fetch_.withTimeout(`${URL}?${new URLSearchParams({
        appid: common_.SECRETS.WOLFRAM_ALPHA_APP_ID,
        output: 'JSON',
        input: query,
    })}`, {}, TIMEOUT);
    if (!resp.ok) {
        const msg = `wolfram alpha query api error, status: ${resp.status}`;
        const body = await fetch_.parseRespBody(resp);
        log.log(msg, {correlationId, body});
        throw new Error(msg);
    }
    const data = await resp.json();
    const {pods: rawPods} = data.queryresult;
    const pods = rawPods || [];
    return {
        pods,
    };
});

export default {
    query,
};
