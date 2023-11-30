import * as tiktoken from 'js-tiktoken';
import wrapper from '../../util/wrapper.js';

const ENCODING = 'cl100k_base';

const enc = tiktoken.getEncoding(ENCODING);

const countTokens = wrapper.logCorrelationId('repository.llm.tokenizer.countTokens', async (correlationId, text) => {
    const tokens = enc.encode(text);
    return tokens.length;
});

const truncate = wrapper.logCorrelationId('repository.llm.tokenizer.truncate', async (correlationId, text, maxTokens) => {
    const tokens = enc.encode(text);
    const tokenCount = tokens.length;
    const truncated = tokenCount <= maxTokens
        ? text : enc.decode(tokens.slice(0, maxTokens));
    return {
        truncated,
        tokenCount,
    };
});

export default {
    countTokens,
    truncate,
};
