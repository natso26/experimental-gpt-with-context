import common from '../common.js';
import common_ from '../../common.js';
import fetch_ from '../../util/fetch.js';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';

const URL = 'https://api.wolframalpha.com/v2/query';
const TIMEOUT = strictParse.int(process.env.WOLFRAM_ALPHA_QUERY_API_TIMEOUT_SECS) * 1000;

const query = wrapper.logCorrelationId('repository.web.wolframAlpha.query', async (correlationId, ip, query) => {
    const resp = await fetch_.withTimeout(`${URL}?${new URLSearchParams({
        appid: common_.SECRETS.WOLFRAM_ALPHA_APP_ID,
        format: 'plaintext',
        output: 'JSON',
        input: query,
        ip,
    })}`, {}, TIMEOUT);
    await common.checkRespOk(correlationId, log.log, (resp) => `wolfram alpha query api error, status: ${resp.status}, query: ${query}`, resp);
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
