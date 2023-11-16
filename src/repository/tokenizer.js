import * as tiktoken from 'js-tiktoken';
import wrapper from '../util/wrapper.js';

const ENCODING = 'cl100k_base';

const enc = tiktoken.getEncoding(ENCODING);

const countTokens = wrapper.logCorrelationId('repository.tokenizer.countTokens', async (correlationId, text) => {
    const tokens = enc.encode(text);
    return tokens.length;
});

export default {
    countTokens,
};
