import common_ from '../../common.js';
import fetch_ from '../../util/fetch.js';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';

const URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4-1106-preview';
const TOP_P = .001;
const TIMEOUT = strictParse.int(process.env.CHAT_COMPLETIONS_API_TIMEOUT_SECS) * 1000;

const chat = wrapper.logCorrelationId('repository.llm.chat.chat', async (correlationId, content, maxTokens, shortCircuitHook, fn) => {
    const resp = await fetch_.withTimeout(URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${common_.SECRETS.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            stream: true,
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
    const data = await streamReadBody(correlationId, resp, shortCircuitHook);
    const {content: content_, toolCalls} = data;
    const functionCalls = toolCalls.map((call) => {
        const {name, args: rawArgs} = call;
        try {
            const args = JSON.parse(rawArgs);
            return {
                name,
                args,
            };
        } catch (e) {
            log.log(`chat completions api: invalid json for args of function: ${name}`,
                {correlationId, name, rawArgs, error: e.message || '', stack: e.stack || ''});
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

const streamReadBody = async (correlationId, resp, shortCircuitHook) => {
    let content = '';
    let toolCalls = [];
    const processChunk = (chunk) => {
        if (chunk === '[DONE]') {
            return;
        }
        try {
            const chunkData = JSON.parse(chunk);
            const {content: chunkContent, tool_calls: chunkToolCalls} = chunkData.choices[0].delta;
            if (chunkContent) {
                content += chunkContent;
            }
            if (chunkToolCalls) {
                for (const call of chunkToolCalls) {
                    const i = call.index;
                    toolCalls[i] ||= {};
                    const toolCall = toolCalls[i];
                    const {name, arguments: args} = call.function;
                    if (name) {
                        toolCall.name = name;
                    }
                    if (args) {
                        toolCall.args = (toolCall.args || '') + args;
                    }
                }
            }
        } catch (e) {
            log.log(`chat completions api: invalid json for chunk: ${chunk}`,
                {correlationId, chunk, error: e.message || '', stack: e.stack || ''});
        }
    };
    let currChunk = '';
    for await (const s of resp.body) {
        const lines = s.toString().split('\n');
        for (const line of lines) {
            if (!line) {
                continue;
            }
            if (!line.startsWith('data: ')) {
                currChunk += line;
                continue;
            }
            if (currChunk) {
                processChunk(currChunk);
                const shortCircuit = shortCircuitHook?.({content, toolCalls});
                if (shortCircuit) {
                    log.log('chat completions api: short circuiting',
                        {correlationId, content, toolCalls});
                    return shortCircuit;
                }
            }
            currChunk = line.slice(6); // length of 'data: '
        }
    }
    if (currChunk) {
        processChunk(currChunk);
    }
    return {content, toolCalls};
};

export default {
    chat,
};
