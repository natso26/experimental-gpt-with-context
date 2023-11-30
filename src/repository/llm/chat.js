import common_ from '../../common.js';
import fetch_ from '../../util/fetch.js';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';

const URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4-1106-preview';
const TOP_P = .001;
const TIMEOUT = strictParse.int(process.env.CHAT_COMPLETIONS_API_TIMEOUT_SECS) * 1000;

const chat = wrapper.logCorrelationId('repository.llm.chat.chat', async (correlationId, content, maxTokens, fn) => {
    const resp = await fetch_.withTimeout(URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${common_.SECRETS.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: MODEL,
            // NB: forego chat capabilities in favor of a single system message
            messages: [
                {
                    role: 'system',
                    content,
                },
            ],
            // NB: forego multiple functions
            ...(!fn ? {} : {
                tools: [
                    {
                        type: 'function',
                        function: fn,
                    },
                ],
            }),
            temperature: 1,
            max_tokens: maxTokens,
            top_p: TOP_P,
            frequency_penalty: 0,
            presence_penalty: 0,
        }),
    }, TIMEOUT);
    if (!resp.ok) {
        const msg = `chat completions api error, status: ${resp.status}`;
        const body = await fetch_.parseRespBody(resp);
        log.log(msg, {correlationId, body});
        throw new Error(msg);
    }
    const data = await resp.json();
    const {content: rawContent, tool_calls: rawToolCalls} = data.choices[0].message;
    const content_ = rawContent || null;
    const toolCalls = rawToolCalls || [];
    const functionCalls = toolCalls.map((call) => {
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
        content: content_,
        functionCalls,
    };
});

export default {
    chat,
};
