import fetch_ from '../util/fetch.js';
import wrapper from '../util/wrapper.js';

const URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4-1106-preview';
const TOP_P = .001;
const TIMEOUT = parseInt(process.env.CHAT_COMPLETIONS_API_TIMEOUT_SECS) * 1000;

const chat = wrapper.logCorrelationId('repository.chat.chat', async (correlationId, content, maxTokens) => {
    const res = await fetch_.withTimeout(URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: MODEL,
            // NB: we take the approach of foregoing the "chat" capabilities and interpret
            // all input as the "system message"
            messages: [
                {
                    role: 'system',
                    content,
                },
            ],
            temperature: 1,
            max_tokens: maxTokens,
            top_p: TOP_P,
            frequency_penalty: 0,
            presence_penalty: 0,
        }),
    }, TIMEOUT);
    if (!res.ok) {
        throw new Error(`chat completions api error, status: ${res.status}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
});

export default {chat};
