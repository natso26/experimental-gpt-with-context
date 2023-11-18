import fetch_ from '../util/fetch.js';
import strictParse from '../util/strictParse.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4-1106-preview';
const TOP_P = .001;
const TIMEOUT = strictParse.int(process.env.CHAT_COMPLETIONS_API_TIMEOUT_SECS) * 1000;

const chat = wrapper.logCorrelationId('repository.chat.chat', async (correlationId, content, maxTokens, functions) => {
    const toolsInfo = !functions.length ? {} : {
        tools: functions.map((f) => ({
            type: 'function',
            function: f,
        })),
    };
    const res = await fetch_.withTimeout(URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: MODEL,
            // NB: we take the approach of foregoing the "chat" capabilities and interpret
            // all input as "system message"
            messages: [
                {
                    role: 'system',
                    content,
                },
            ],
            ...toolsInfo,
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
    const {content: content_, tool_calls} = data.choices[0].message;
    if (content_) {
        return {
            content: content_,
        };
    }
    const functionCalls = tool_calls.map((call) => {
        const {name, arguments: rawArgs} = call.function;
        try {
            const args = JSON.parse(rawArgs);
            return {
                name,
                args,
            };
        } catch (e) {
            log.log(`chat completions api: model gave invalid json for args of function: ${name}`,
                {name, rawArgs, error: e.message || '', stack: e.stack || ''});
            return {
                name,
            };
        }
    });
    return {
        functionCalls,
    };
});

export default {
    chat,
};
