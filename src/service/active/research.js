import tokenizer from '../../repository/llm/tokenizer.js';
import serp from '../../repository/web/serp.js';
import memory from '../../repository/db/memory.js';
import common from '../common.js';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';
import time from '../../util/time.js';

const ACTION_LVL = 1; // NB: research is immediate subtask
const MODEL_ANSWER_PROMPT = (input, query, recursedNote, recursedQuery) =>
    common.MODEL_PROMPT_CORE_MSG
    + `\n${common.MODEL_PROMPT_INTERNAL_COMPONENT_MSG}`
    + `\ntime: ${common.MODEL_PROMPT_FORMATTED_TIME()}`
    + `\ninput: ${input}`
    + `\nquery: ${JSON.stringify(query)}`
    + (!recursedNote ? '' : `\ninternal recursed note: ${JSON.stringify(recursedNote)}`)
    + `\ninternal recursed query: ${JSON.stringify(recursedQuery)}`
    + `\nsynthesize`;
const MODEL_CONCLUSION_PROMPT = (answers, query, recursedNote, recursedQuery) =>
    common.MODEL_PROMPT_CORE_MSG
    + `\n${common.MODEL_PROMPT_INTERNAL_COMPONENT_MSG}`
    + `\ntime: ${common.MODEL_PROMPT_FORMATTED_TIME()}`
    + `\nanswers: ${JSON.stringify(answers)}`
    + `\nquery: ${JSON.stringify(query)}`
    + (!recursedNote ? '' : `\ninternal recursed note: ${JSON.stringify(recursedNote)}`)
    + `\ninternal recursed query: ${JSON.stringify(recursedQuery)}`
    + `\naggregate`;
const ACTION_KIND_ANSWER = 'research-answer';
const RECURSED_NOTE_TOKEN_COUNT_LIMIT = strictParse.int(process.env.RESEARCH_RECURSED_NOTE_TOKEN_COUNT_LIMIT);
const RECURSED_QUERY_TOKEN_COUNT_LIMIT = strictParse.int(process.env.RESEARCH_RECURSED_QUERY_TOKEN_COUNT_LIMIT);
const URL_COUNT = strictParse.int(process.env.RESEARCH_URL_COUNT);
const RETRY_NEW_URL_COUNT = strictParse.int(process.env.RESEARCH_RETRY_NEW_URL_COUNT);
const INPUT_TRUNCATION_TOKEN_COUNT = strictParse.int(process.env.RESEARCH_INPUT_TRUNCATION_TOKEN_COUNT);
const INPUT_MIN_TOKEN_COUNT = strictParse.int(process.env.RESEARCH_INPUT_MIN_TOKEN_COUNT);
const ANSWER_TOKEN_COUNT_LIMIT = strictParse.int(process.env.RESEARCH_ANSWER_TOKEN_COUNT_LIMIT);
const SHORT_CIRCUIT_TO_ANSWER_OVERLAPPING_TOKENS = strictParse.int(process.env.RESEARCH_SHORT_CIRCUIT_TO_ANSWER_OVERLAPPING_TOKENS);
const CONCLUSION_TOKEN_COUNT_LIMIT = strictParse.int(process.env.RESEARCH_CONCLUSION_TOKEN_COUNT_LIMIT);

const research = wrapper.logCorrelationId('service.active.research.research', async (correlationId, userId, sessionId, query, recursedNote, recursedQuery) => {
    log.log('research: parameters',
        {correlationId, userId, sessionId, query, recursedNote, recursedQuery});
    const docId = common.DOC_ID.from(userId, sessionId);
    const start = new Date();
    const {recursedNoteTokenCount, recursedQueryTokenCount} =
        await getTokenCounts(correlationId, docId, recursedNote, recursedQuery);
    const {data: search} = await common.serpSearchWithRetry(correlationId, recursedQuery);
    const urls = !search ? [] : serp.getOrganicLinks(search);
    log.log('research: urls', {correlationId, docId, urls});
    if (!urls.length) {
        return {
            state: 'no-urls',
            elapsed: time.elapsedSecs(start),
            reply: null,
        };
    }
    const answerTaskCount = Math.min(URL_COUNT, urls.length);
    let availableI = answerTaskCount;
    const answerTasks = [...Array(answerTaskCount).keys()].map((i) => (async () => {
        let currI = i;
        let answer = {answer: null};
        for (let j = 0; j <= RETRY_NEW_URL_COUNT; j++) {
            answer = await getAnswer(correlationId, docId, query, recursedNote, recursedQuery, urls[currI]);
            if (answer.answer || availableI >= urls.length || j === RETRY_NEW_URL_COUNT) {
                break;
            }
            log.log('research: no answer; retry new url', {correlationId, docId, oldUrl: urls[currI]});
            currI = availableI;
            availableI++;
        }
        return {
            url: urls[currI],
            ...answer,
        };
    })());
    answerTasks.forEach((task) => task.then(async (res) => {
        const {answer} = res;
        if (!answer) {
            return;
        }
        await memory.addAction(correlationId, docId, ACTION_LVL, {
            [common.KIND_FIELD]: ACTION_KIND_ANSWER,
            [common.RECURSED_NOTE_FIELD]: recursedNote || '',
            [common.RECURSED_QUERY_FIELD]: recursedQuery,
            [common.REPLY_FIELD]: answer,
        }, {correlationId}).catch((e) =>
            log.log('research: add answer failed; continue since it is not critical', {
                correlationId, docId, error: e.message || '', stack: e.stack || '',
            }));
    }));
    const answers = (await Promise.all(answerTasks))
        .filter(({answer}) => answer);
    const formattedAnswers = answers.map(({answer}) => answer);
    if (!answers.length) {
        return {
            state: 'no-answers',
            elapsed: time.elapsedSecs(start),
            reply: null,
        };
    }
    const answersShortCircuitHook = common.shortCircuitAutocompleteContentHook(
        correlationId, SHORT_CIRCUIT_TO_ANSWER_OVERLAPPING_TOKENS);
    await Promise.all(formattedAnswers.map(
        (answer) => answersShortCircuitHook.add(answer)));
    const conclusionPrompt = MODEL_CONCLUSION_PROMPT(formattedAnswers, query, recursedNote, recursedQuery);
    log.log('research: conclusion prompt', {correlationId, docId, conclusionPrompt});
    const {content: conclusion} = await common.chatWithRetry(
        correlationId, null, conclusionPrompt, CONCLUSION_TOKEN_COUNT_LIMIT, answersShortCircuitHook, null);
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
        roughCost: common.sum(answers.map((v) => v.roughCost || 0)) + common.CHAT_COST(conclusionPromptTokenCount, conclusionTokenCount),
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
        throw new Error('query: recursed note or query token count exceeds limit:' +
            ` ${recursedNoteTokenCount} > ${RECURSED_NOTE_TOKEN_COUNT_LIMIT} or ${recursedQueryTokenCount} > ${RECURSED_QUERY_TOKEN_COUNT_LIMIT}`);
    }
    return {recursedNoteTokenCount, recursedQueryTokenCount};
};

const getAnswer = async (correlationId, docId, query, recursedNote, recursedQuery, url) => {
    log.log('research: get answer: parameters', {correlationId, docId, query, recursedNote, recursedQuery, url});
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
            if (inputTokenCount < INPUT_MIN_TOKEN_COUNT) {
                log.log('research: get answer: input has too few tokens; skip',
                    {correlationId, docId, url, inputTokenCount});
            } else {
                const answerPrompt = MODEL_ANSWER_PROMPT(input, query, recursedNote, recursedQuery);
                log.log('research: get answer: answer prompt', {correlationId, docId, url, answerPrompt});
                const {content: answer_} = await common.chatWithRetry(
                    correlationId, null, answerPrompt, ANSWER_TOKEN_COUNT_LIMIT, null, null);
                answer = answer_;
                answerPromptTokenCount = await tokenizer.countTokens(correlationId, answerPrompt);
                answerTokenCount = await tokenizer.countTokens(correlationId, answer);
            }
        }
    } catch (e) {
        log.log('research: get answer: failed', {
            correlationId, docId, query, recursedNote, recursedQuery, url,
            error: e.message || '', stack: e.stack || '',
        });
    }
    return {
        answer,
        input,
        tokenCounts: {
            input: inputTokenCount,
            answerPrompt: answerPromptTokenCount,
            answer: answerTokenCount,
        },
        roughCost: common.CHAT_COST(answerPromptTokenCount, answerTokenCount),
    };
};

export default {
    research,
};
