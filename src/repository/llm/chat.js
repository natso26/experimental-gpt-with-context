import tokenizer from './tokenizer.js';
import common from '../common.js';
import common_ from '../../common.js';
import fetch_ from '../../util/fetch.js';
import number from '../../util/number.js';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';
import cache from '../../util/cache.js';
import wrapper from '../../util/wrapper.js';
import time from '../../util/time.js';
import error from '../../util/error.js';

const URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4-1106-preview';
const TOP_P = strictParse.float(process.env.CHAT_COMPLETIONS_API_TOP_P);
const TIMEOUT = strictParse.int(process.env.CHAT_COMPLETIONS_API_TIMEOUT_SECS) * 1000;
const RETRY_429_BACKOFFS = strictParse.json(process.env.CHAT_COMPLETIONS_API_RETRY_429_BACKOFFS_MS);
const EMPTY_USAGE = () => ({inTokens: 0, outTokens: 0});
const _DEV_FLAG_NOT_STREAM = false;
(process.env.ENV === 'local' || !_DEV_FLAG_NOT_STREAM) || (() => {
    throw new Error('_DEV_FLAG_NOT_STREAM not correctly set');
})();

const chat = wrapper.logCorrelationId('repository.llm.chat.chat', async (correlationId, onPartial, input, maxTokens, shortCircuitHook, fn, warnings) => {
    const resp = await common.retry429(correlationId, () => fetch_.withTimeout(URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${common_.SECRETS.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            stream: !_DEV_FLAG_NOT_STREAM,
            model: MODEL,
            // NB: forego chat capabilities in favor of a single system message
            messages: [
                {
                    role: 'system',
                    content: input,
                },
            ],
            // NB: forego multiple functions
            ...(!fn ? {} : {
                tools: [
                    {
                        type: 'function',
                        function: fn.VAL,
                    },
                ],
            }),
            temperature: 1,
            max_tokens: maxTokens,
            top_p: TOP_P,
            frequency_penalty: 0,
            presence_penalty: 0,
        }),
    }, TIMEOUT), RETRY_429_BACKOFFS);
    log.log('chat completions api: resp headers', {correlationId, headers: Object.fromEntries(resp.headers)});
    await common.checkRespOk(correlationId, warnings, (resp) => `chat completions api error, status: ${resp.status}`, resp);
    const timer = time.timer();
    const data = await streamReadBody(correlationId, onPartial, resp, timer, shortCircuitHook, warnings);
    try {
        resp.body.destroy(); // early return
    } catch (e) {
        log.log('chat completions api: problem destroying response body', {correlationId, ...error.explain(e)});
    }
    const {content, toolCalls} = data;
    const functionCalls = toolCalls.map((call) => {
        const {name, args: rawArgs} = call;
        try {
            const args = JSON.parse(rawArgs);
            return {
                name,
                args,
            };
        } catch (e) {
            warnings(`chat completions api: invalid json for args of function: ${name}`,
                {correlationId, name, rawArgs, ...error.explain(e)});
            return {
                name,
            };
        }
    });
    const usage = await tokenUsage(correlationId, input, fn, content, toolCalls, warnings);
    const out = {
        content,
        functionCalls,
        usage,
    };
    log.log('chat completions api: out', {correlationId, out});
    return out;
});

const streamReadBody = async (correlationId, onPartial, resp, timer, shortCircuitHook, warnings) => {
    if (_DEV_FLAG_NOT_STREAM) {
        return await _notStreamReadBody(correlationId, resp);
    }
    let content = '';
    let toolCalls = [];
    let wantThrow = false;
    const processChunk = (chunk) => {
        try {
            const chunkData = JSON.parse(chunk);
            if (chunkData.error) {
                const msg = 'chat completions api: error while streaming';
                warnings(msg, {correlationId, chunkData});
                wantThrow = true;
                throw new Error(msg);
            }
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
            if (wantThrow) {
                throw e;
            }
            log.log(`chat completions api: invalid json for chunk: ${chunk}`,
                {correlationId, chunk, ...error.explain(e)});
        }
        return false;
    };
    let currChunk = null; // empty string ambiguous
    let tempPrefix = '';
    for await (const b of resp.body) {
        const lines = b.toString().split('\n');
        for (const line of lines) {
            if (!line) {
                if (currChunk === null) { // pass
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
                    currChunk = null;
                }
            } else if (currChunk === null) {
                // length of 'data: ' is 6
                const line_ = tempPrefix + line;
                if (line_.length < 6) {
                    tempPrefix = line_;
                } else {
                    tempPrefix = '';
                    if (!line_.startsWith('data: ')) {
                        log.log(`chat completions api: invalid line: ${line_}`,
                            {correlationId, line: line_});
                    } else {
                        currChunk = line_.slice(6);
                    }
                }
            } else {
                currChunk += line;
            }
        }
        if (1000 * timer.elapsed() > TIMEOUT) { // separate from req timeout
            warnings.strong('chat completions api: timeout', {correlationId});
            break;
        }
    }
    return {content, toolCalls};
};

const tokenUsage = async (correlationId, input, fn, content, toolCalls, warnings) => {
    try {
        const doCount = wrapper.cache(cache.lruTtl(50, 1000), (s) => s,
            (s) => tokenizer.countTokens(correlationId, s));
        const countToolCall = async ({name, args}) => await doCount(name) + await doCount(args);
        const inputPad = 7;
        // NB: sometimes off by a few tokens
        const toolCallsPad = (toolCalls) => {
            const l = toolCalls.length;
            return !l ? 0 : l === 1 ? 7 : 21 * (l + 1);
        };
        const inputTokens = await doCount(input) + inputPad;
        const fnTokens = fn?.TOKEN_COUNT || 0;
        const contentTokens = !content ? 0 : await doCount(content);
        const toolCallsTokens = number.sum(await Promise.all(toolCalls.map(countToolCall))) + toolCallsPad(toolCalls);
        const inTokens = inputTokens + fnTokens;
        const outTokens = contentTokens + toolCallsTokens; // NB: only tested with exactly one present
        const usage = {
            inTokens,
            outTokens,
        };
        log.log('chat completions api: token usage', {correlationId, usage});
        return usage;
    } catch (e) {
        warnings('chat completions api: failed to determine token usage', {correlationId}, e);
        return EMPTY_USAGE();
    }
};

const _notStreamReadBody = async (correlationId, resp) => {
    const data = await resp.json();
    log.log('chat completions api: data', {correlationId, data});
    const {content: content_, tool_calls: toolCalls_} = data.choices[0].message;
    const content = content_ || '';
    const toolCalls = (toolCalls_ || []).map(({function: {name, arguments: args}}) => ({name, args}));
    return {content, toolCalls};
};

export default {
    EMPTY_USAGE,
    chat,
};
