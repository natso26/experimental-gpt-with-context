import common_ from '../common.js';
import fetch_ from '../util/fetch.js';
import strictParse from '../util/strictParse.js';
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
        throw new Error(`embeddings api error, status: ${resp.status}`);
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
