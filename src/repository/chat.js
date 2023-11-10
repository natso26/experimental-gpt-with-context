import common from './common.js';
import wrapper from '../util/wrapper.js';

const chat = wrapper.logCorrelationId('repository.chat.chat', async (correlationId, messages) => {
    const res = await common.fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: 'gpt-4-1106-preview',
            messages,
            temperature: 1,
            max_tokens: 512,
            top_p: 0.001,
            frequency_penalty: 0,
            presence_penalty: 0,
        }),
    }, 120 * 1000);
    if (!res.ok) {
        throw new Error(`chat completions error, status: ${res.status}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
});

export default {chat};
