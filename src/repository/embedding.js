import wrapper from '../util/wrapper.js';

const embed = wrapper.logCorrelationId('repository.embedding.embed', async (correlationId, text) => {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: 'text-embedding-ada-002',
            input: text,
        }),
    });
    if (!res.ok) {
        throw new Error(`embeddings error, status: ${res.status}`);
    }
    const data = await res.json();
    return data.data[0].embedding;
});

export default {embed};
