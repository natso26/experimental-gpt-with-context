import tokenizer from '../repository/tokenizer.js';
import serp from '../repository/serp.js';
import common from './common.js';
import strictParse from '../util/strictParse.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';
import time from "../util/time.js";

const MODEL_ANSWER_PROMPT = (input, recursedNote, recursedQuery) =>
    common.MODEL_PROMPT_INTERNAL_COMPONENT_MSG
    + `\ninput: ${input}`
    + (!recursedNote ? '' : `\ninternal recursed note: ${JSON.stringify(recursedNote)}`)
    + `\ninternal recursed query: ${JSON.stringify(recursedQuery)}`
    + `\nsynthesize`;
const MODEL_CONCLUSION_PROMPT = (answers, recursedNote, recursedQuery) =>
    common.MODEL_PROMPT_INTERNAL_COMPONENT_MSG
    + `\nanswers: ${JSON.stringify(answers)}`
    + (!recursedNote ? '' : `\ninternal recursed note: ${JSON.stringify(recursedNote)}`)
    + `\ninternal recursed query: ${JSON.stringify(recursedQuery)}`
    + `\nsynthesize`;
const RECURSED_NOTE_TOKEN_COUNT_LIMIT = strictParse.int(process.env.RESEARCH_RECURSED_NOTE_TOKEN_COUNT_LIMIT);
const RECURSED_QUERY_TOKEN_COUNT_LIMIT = strictParse.int(process.env.RESEARCH_RECURSED_QUERY_TOKEN_COUNT_LIMIT);
const URL_COUNT = strictParse.int(process.env.RESEARCH_URL_COUNT);
const INPUT_TRUNCATION_TOKEN_COUNT = strictParse.int(process.env.RESEARCH_INPUT_TRUNCATION_TOKEN_COUNT);
const ANSWER_TOKEN_COUNT_LIMIT = strictParse.int(process.env.RESEARCH_ANSWER_TOKEN_COUNT_LIMIT);
const CONCLUSION_TOKEN_COUNT_LIMIT = strictParse.int(process.env.RESEARCH_CONCLUSION_TOKEN_COUNT_LIMIT);

const research = wrapper.logCorrelationId('service.research.research', async (correlationId, userId, sessionId, recursedNote, recursedQuery) => {
    log.log('research: parameters', {correlationId, userId, sessionId, recursedNote, recursedQuery});
    const docId = common.DOC_ID.from(userId, sessionId);
    const start = new Date();
    const {recursedNoteTokenCount, recursedQueryTokenCount} =
        await getTokenCounts(correlationId, docId, recursedNote, recursedQuery);
    const {data: search} = await common.serpSearchWithRetry(correlationId, recursedQuery);
    const rawUrls = !search ? [] : serp.getOrganicLinks(search);
    log.log('research: raw urls', {correlationId, docId, rawUrls});
    if (!rawUrls.length) {
        return {
            state: 'no_search_links',
            elapsed: time.elapsedSecs(start),
            reply: null,
        };
    }
    const urls = rawUrls.slice(0, URL_COUNT);
    const answerTasks = [];
    for (const url of urls) {
        answerTasks.push((async () => {
            const answer = await getAnswer(correlationId, docId, recursedNote, recursedQuery, url);
            return {
                url,
                ...answer,
            };
        })());
    }
    const answers = (await Promise.all(answerTasks))
        .filter(({answer}) => answer);
    const formattedAnswers = answers.map(({answer}) => answer);
    if (!answers.length) {
        return {
            state: 'no_answers',
            elapsed: time.elapsedSecs(start),
            reply: null,
        };
    }
    const conclusionPrompt = MODEL_CONCLUSION_PROMPT(formattedAnswers, recursedNote, recursedQuery);
    log.log('research: conclusion prompt', {correlationId, docId, conclusionPrompt});
    const {content: conclusion} = await common.chatWithRetry(
        correlationId, conclusionPrompt, CONCLUSION_TOKEN_COUNT_LIMIT, null);
    const conclusionPromptTokenCount = await tokenizer.countTokens(correlationId, conclusionPrompt);
    const conclusionTokenCount = await tokenizer.countTokens(correlationId, conclusion);
    return {
        state: 'success',
        elapsed: time.elapsedSecs(start),
        reply: conclusion,
        answers,
        tokenCounts: {
            recursedNote: recursedNoteTokenCount,
            recursedQuery: recursedQueryTokenCount,
            conclusionPrompt: conclusionPromptTokenCount,
            conclusion: conclusionTokenCount,
        },
    };
});

const getTokenCounts = async (correlationId, docId, recursedNote, recursedQuery) => {
    let recursedNoteTokenCount = 0;
    if (recursedNote) {
        recursedNoteTokenCount = await tokenizer.countTokens(correlationId, recursedNote);
    }
    const recursedQueryTokenCount = await tokenizer.countTokens(correlationId, recursedQuery);
    log.log('query: recursed note and query token counts',
        {correlationId, docId, recursedNoteTokenCount, recursedQueryTokenCount});
    if (recursedNoteTokenCount > RECURSED_NOTE_TOKEN_COUNT_LIMIT
        || recursedQueryTokenCount > RECURSED_QUERY_TOKEN_COUNT_LIMIT) {
        throw new Error(`query: recursed note or query token count exceeds limit:` +
            ` ${recursedNoteTokenCount} > ${RECURSED_NOTE_TOKEN_COUNT_LIMIT} or ${recursedQueryTokenCount} > ${RECURSED_QUERY_TOKEN_COUNT_LIMIT}`);
    }
    return {recursedNoteTokenCount, recursedQueryTokenCount};
};

const getAnswer = async (correlationId, docId, recursedNote, recursedQuery, url) => {
    log.log('research: get answer: parameters', {correlationId, docId, recursedNote, recursedQuery, url});
    let input = '';
    let answer = '';
    let inputTokenCount = 0;
    let answerPromptTokenCount = 0;
    let answerTokenCount = 0;
    try {
        const {textData: rawInput} = await common.scraperExtractWithRetry(correlationId, url);
        if (rawInput) {
            const {truncated, tokenCount} = await tokenizer.truncate(
                correlationId, JSON.stringify(rawInput), INPUT_TRUNCATION_TOKEN_COUNT);
            input = truncated;
            inputTokenCount = Math.min(tokenCount, INPUT_TRUNCATION_TOKEN_COUNT);
            log.log('research: get answer: input', {correlationId, docId, url, input, inputTokenCount});
            const answerPrompt = MODEL_ANSWER_PROMPT(input, recursedNote, recursedQuery);
            log.log('research: get answer: answer prompt', {correlationId, docId, url, answerPrompt});
            const {content: answer_} = await common.chatWithRetry(
                correlationId, answerPrompt, ANSWER_TOKEN_COUNT_LIMIT, null);
            answer = answer_;
            answerPromptTokenCount = await tokenizer.countTokens(correlationId, answerPrompt);
            answerTokenCount = await tokenizer.countTokens(correlationId, answer);
        }
    } catch (e) {
        log.log('research: get answer: failed; continue still',
            {correlationId, docId, recursedNote, recursedQuery, url, error: e.message || '', stack: e.stack || ''});
    }
    return {answer, input, inputTokenCount, answerPromptTokenCount, answerTokenCount};
};

export default {
    research,
};
