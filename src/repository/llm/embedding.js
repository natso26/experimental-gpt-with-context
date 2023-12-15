import common from '../common.js';
import common_ from '../../common.js';
import fetch_ from '../../util/fetch.js';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';
import time from '../../util/time.js';

const URL = 'https://api.openai.com/v1/embeddings';
const MODEL = 'text-embedding-ada-002';
const TIMEOUT = strictParse.int(process.env.EMBEDDINGS_API_TIMEOUT_SECS) * time.SECOND;

const embed = wrapper.logCorrelationId('repository.llm.embedding.embed', async (correlationId, text) => {
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
    await common.checkRespOk(correlationId, log.log, (resp) => `embeddings api error, status: ${resp.status}`, resp);
    const data = await resp.json();
    const {embedding} = data.data[0];
    return {
        embedding,
    };
});

export default {
    embed,
};
