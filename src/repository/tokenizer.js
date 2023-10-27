import * as tiktoken from 'js-tiktoken';
import wrapper from '../util/wrapper.js';

const enc = tiktoken.getEncoding('cl100k_base');

const countTokens = wrapper.logCorrelationId('repository.tokenizer.countTokens', async (correlationId, text) => {
    const tokens = enc.encode(text);
    return tokens.length;
});

export default {countTokens};
