import fetch_ from '../util/fetch.js';
import strictParse from '../util/strictParse.js';
import wrapper from '../util/wrapper.js';

const URL = 'https://api.wolframalpha.com/v2/query';
const TIMEOUT = strictParse.int(process.env.WOLFRAM_ALPHA_QUERY_API_TIMEOUT_SECS) * 1000;

const query = wrapper.logCorrelationId('repository.wolframAlpha.query', async (correlationId, query) => {
    const res = await fetch_.withTimeout(`${URL}?${new URLSearchParams({
        appid: process.env.WOLFRAM_ALPHA_APP_ID,
        input: query,
        output: 'JSON',
    })}`, {}, TIMEOUT);
    if (!res.ok) {
        throw new Error(`wolfram alpha query api error, status: ${res.status}`);
    }
    const data = await res.json();
    const {pods: rawPods} = data.queryresult;
    const pods = rawPods || [];
    return {
        pods,
    };
});

export default {
    query,
};
