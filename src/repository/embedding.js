import common_ from '../common.js';
import fetch_ from '../util/fetch.js';
import strictParse from '../util/strictParse.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const URL = 'https://api.openai.com/v1/embeddings';
const MODEL = 'text-embedding-ada-002';
const TIMEOUT = strictParse.int(process.env.EMBEDDINGS_API_TIMEOUT_SECS) * 1000;

const embed = wrapper.logCorrelationId('repository.embedding.embed', async (correlationId, text) => {
    const resp = await fetch_.withTimeout(URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${common_.SECRETS.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: MODEL,
            input: text,
        }),
    }, TIMEOUT);
    if (!resp.ok) {
        const msg = `embeddings api error, status: ${resp.status}`;
        const body = await fetch_.parseRespBody(resp);
        log.log(msg, {correlationId, body});
        throw new Error(msg);
    }
    const data = await resp.json();
    const {embedding} = data.data[0];
    return {
        embedding,
    };
});

export default {
    embed,
};
