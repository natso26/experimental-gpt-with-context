import fetch_ from '../util/fetch.js';
import wrapper from '../util/wrapper.js';

const URL = 'https://api.openai.com/v1/embeddings';
const MODEL = 'text-embedding-ada-002';
const TIMEOUT = parseInt(process.env.EMBEDDINGS_API_TIMEOUT_SECS) * 1000;

const embed = wrapper.logCorrelationId('repository.embedding.embed', async (correlationId, text) => {
    const res = await fetch_.withTimeout(URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: MODEL,
            input: text,
        }),
    }, TIMEOUT);
    if (!res.ok) {
        throw new Error(`embeddings api error, status: ${res.status}`);
    }
    const data = await res.json();
    const {embedding} = data.data[0];
    return {
        embedding,
    };
});

export default {
    embed,
};
