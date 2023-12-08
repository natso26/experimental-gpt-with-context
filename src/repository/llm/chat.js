import common_ from '../../common.js';
import fetch_ from '../../util/fetch.js';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';
import time from '../../util/time.js';

const URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4-1106-preview';
const TOP_P = strictParse.float(process.env.CHAT_COMPLETIONS_API_TOP_P);
const TIMEOUT = strictParse.int(process.env.CHAT_COMPLETIONS_API_TIMEOUT_SECS) * 1000;

const chat = wrapper.logCorrelationId('repository.llm.chat.chat', async (correlationId, onPartial, content, maxTokens, shortCircuitHook, fn) => {
    const timer = time.timer();
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
    const data = await streamReadBody(correlationId, onPartial, resp, timer, shortCircuitHook);
    try {
        resp.body.destroy(); // early return
    } catch (e) {
        log.log('chat completions api: problem destroying response body',
            {correlationId, error: e.message || '', stack: e.stack || ''});
    }
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
    const out = {
        content: content_,
        functionCalls,
    };
    log.log('chat completions api: out', {correlationId, out});
    return out;
});

const streamReadBody = async (correlationId, onPartial, resp, timer, shortCircuitHook) => {
    let content = '';
    let toolCalls = [];
    const processChunk = (chunk) => {
        try {
            const chunkData = JSON.parse(chunk);
            const {delta: {content: chunkContent, tool_calls: chunkToolCalls}, finish_reason: chunkFinishReason}
                = chunkData.choices[0];
            if (chunkContent) {
                content += chunkContent;
                if (!chunkFinishReason && onPartial) {
                    onPartial({content});
                }
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
            if (chunkFinishReason) { // minor optimization
                return true;
            }
        } catch (e) {
            log.log(`chat completions api: invalid json for chunk: ${chunk}`,
                {correlationId, chunk, error: e.message || '', stack: e.stack || ''});
        }
        return false;
    };
    let currChunk = '';
    for await (const b of resp.body) {
        const lines = b.toString().split('\n');
        for (const line of lines) {
            if (!line) {
                if (!currChunk) { // pass
                } else {
                    const isDone = processChunk(currChunk);
                    if (isDone) {
                        return {content, toolCalls};
                    }
                    const shortCircuit = shortCircuitHook?.({content, toolCalls});
                    if (shortCircuit) {
                        log.log('chat completions api: short circuiting',
                            {correlationId, content, toolCalls});
                        return shortCircuit;
                    }
                    currChunk = '';
                }
            } else if (!currChunk) {
                if (!line.startsWith('data: ')) {
                    log.log(`chat completions api: invalid line: ${line}`,
                        {correlationId, line});
                } else {
                    currChunk = line.slice(6); // length of 'data: '
                }
            } else {
                currChunk += line;
            }
        }
        if (1000 * timer.elapsed() > TIMEOUT) { // separate from req timeout
            log.log('chat completions api: timeout', {correlationId});
            break;
        }
    }
    return {content, toolCalls};
};

export default {
    chat,
};
