import tokenizer from '../../repository/llm/tokenizer.js';
import chat from '../../repository/llm/chat.js';
import serp from '../../repository/web/serp.js';
import memory from '../../repository/db/memory.js';
import commonActive from './common.js';
import common from '../common.js';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';
import time from '../../util/time.js';

const ACTION_LVL = 1; // NB: research is immediate subtask
const MODEL_ANSWER_PROMPT = (promptOptions, input, query, recursedNote, recursedQuery) =>
    common.MODEL_PROMPT_CORE_MSG
    + `\n${common.MODEL_PROMPT_INTERNAL_COMPONENT_MSG}`
    + `\n${common.MODEL_PROMPT_OPTIONS_PART(promptOptions)}`
    + `\ninternal input: ${input}`
    + `\nquery: ${JSON.stringify(query)}`
    + (!recursedNote ? '' : `\ninternal recursed note: ${JSON.stringify(recursedNote)}`)
    + `\ninternal recursed query: ${JSON.stringify(recursedQuery)}`
    + `\nsynthesize`;
const MODEL_CONCLUSION_PROMPT = (promptOptions, answers, query, recursedNote, recursedQuery) =>
    common.MODEL_PROMPT_CORE_MSG
    + `\n${common.MODEL_PROMPT_INTERNAL_COMPONENT_MSG}`
    + `\n${common.MODEL_PROMPT_OPTIONS_PART(promptOptions)}`
    + `\ninternal answers: ${JSON.stringify(answers)}`
    + `\nquery: ${JSON.stringify(query)}`
    + (!recursedNote ? '' : `\ninternal recursed note: ${JSON.stringify(recursedNote)}`)
    + `\ninternal recursed query: ${JSON.stringify(recursedQuery)}`
    + `\naggregate`;
const ACTION_KIND_ANSWER = 'research-answer';
const RECURSED_NOTE_TOKEN_COUNT_LIMIT = strictParse.int(process.env.RESEARCH_RECURSED_NOTE_TOKEN_COUNT_LIMIT);
const RECURSED_QUERY_TOKEN_COUNT_LIMIT = strictParse.int(process.env.RESEARCH_RECURSED_QUERY_TOKEN_COUNT_LIMIT);
const SEARCH_MIN_RESULTS_COUNT = strictParse.int(process.env.RESEARCH_SEARCH_MIN_RESULTS_COUNT);
const URL_COUNT = strictParse.int(process.env.RESEARCH_URL_COUNT);
const RETRY_NEW_URL_COUNT = strictParse.int(process.env.RESEARCH_RETRY_NEW_URL_COUNT);
const INPUT_TRUNCATION_TOKEN_COUNT = strictParse.int(process.env.RESEARCH_INPUT_TRUNCATION_TOKEN_COUNT);
const INPUT_MIN_TOKEN_COUNT = strictParse.int(process.env.RESEARCH_INPUT_MIN_TOKEN_COUNT);
const ANSWER_TOKEN_COUNT_LIMIT = strictParse.int(process.env.RESEARCH_ANSWER_TOKEN_COUNT_LIMIT);
const SHORT_CIRCUIT_TO_ANSWER_OVERLAPPING_TOKENS = strictParse.int(process.env.RESEARCH_SHORT_CIRCUIT_TO_ANSWER_OVERLAPPING_TOKENS);
const CONCLUSION_TOKEN_COUNT_LIMIT = strictParse.int(process.env.RESEARCH_CONCLUSION_TOKEN_COUNT_LIMIT);

const research = wrapper.logCorrelationId('service.active.research.research', async (correlationId, userId, sessionId, options, queryInfo) => {
    log.log('research: parameters',
        {correlationId, userId, sessionId, options, queryInfo});
    const {query, recursedNote, backupRecursedQuery, recursedQuery} = queryInfo;
    const warnings = common.warnings();
    const ipGeolocateTask = commonActive.ipGeolocate(correlationId, options, 'research');
    const uuleCanonicalNameTask = commonActive.uuleCanonicalName(correlationId, ipGeolocateTask, warnings, 'research');
    const promptOptionsTask = commonActive.promptOptions(correlationId, options, ipGeolocateTask, warnings, 'research');
    const docId = common.DOC_ID.from(userId, sessionId);
    const timer = time.timer();
    const {recursedNoteTokenCount, recursedQueryTokenCount} =
        await getTokenCounts(correlationId, docId, recursedNote, recursedQuery);
    const uuleCanonicalName = await uuleCanonicalNameTask;
    const urls = combineUrls(...await Promise.all([
        getUrls(correlationId, docId, uuleCanonicalName, recursedQuery, warnings),
        (async () => {
            if (backupRecursedQuery === recursedQuery) {
                return [];
            }
            return await getUrls(correlationId, docId, uuleCanonicalName, backupRecursedQuery, warnings);
        })(),
    ]));
    log.log('research: urls', {correlationId, docId, urls});
    if (!urls.length) {
        return {
            state: 'no-urls',
            reply: null,
            options: {options},
            timeStats: {
                elapsed: timer.elapsed(),
            },
            warnings: warnings.get(),
        };
    }
    const promptOptions = await promptOptionsTask;
    const answerTaskCount = Math.min(URL_COUNT, urls.length);
    const answerCosts = [];
    let availableI = answerTaskCount;
    const rawAnswerTasks = [...Array(answerTaskCount).keys()].map((i) => (async () => {
        const answerTimer = time.timer();
        let currI = i;
        let reply = '';
        let data = null;
        for (let j = 0; j <= RETRY_NEW_URL_COUNT; j++) {
            const o = await getAnswer(
                correlationId, docId, query, recursedNote, recursedQuery, urls[currI], promptOptions);
            reply = o.reply;
            data = o.data;
            if (reply || availableI >= urls.length || j === RETRY_NEW_URL_COUNT) {
                break;
            }
            log.log('research: no answer; retry new url', {correlationId, docId, oldUrl: urls[currI]});
            currI = availableI;
            availableI++;
        }
        if (data?.warnings) {
            warnings.merge(data?.warnings);
        }
        return {
            reply,
            data,
            url: urls[currI],
            timeStats: {
                elapsed: answerTimer.elapsed(),
            },
        };
    })());
    const answers = await Promise.all(rawAnswerTasks.map((task) => task.then(async (res) => {
            const {reply, data, url, timeStats} = res;
            if (!reply) {
                return {
                    reply,
                    url,
                    timeStats,
                };
            }
            const actiobDbExtra = {
                correlationId,
                ...data,
                url,
                timeStats,
            };
            const {index, timestamp} = await memory.addAction(correlationId, docId, ACTION_LVL, {
                [common.KIND_FIELD]: ACTION_KIND_ANSWER,
                [common.RECURSED_NOTE_FIELD]: recursedNote || '',
                [common.RECURSED_QUERY_FIELD]: recursedQuery,
                [common.REPLY_FIELD]: reply,
            }, actiobDbExtra).catch((e) => {
                warnings.strong('research: add answer failed', {correlationId, docId}, e);
                return {index: null, timestamp: null};
            });
            answerCosts.push(data?.cost || null);
            return {
                reply,
                url,
                timeStats,
                index,
                timestamp,
            };
        })
    ));
    const answersForPrompt = answers.filter(({reply}) => reply)
        .map(({reply}) => reply);
    if (!answersForPrompt.length) {
        return {
            state: 'no-answers',
            reply: null,
            options: {options, promptOptions},
            timeStats: {
                elapsed: timer.elapsed(),
            },
            warnings: warnings.get(),
        };
    }
    const answersShortCircuitHook = common.shortCircuitAutocompleteContentHook(
        correlationId, SHORT_CIRCUIT_TO_ANSWER_OVERLAPPING_TOKENS);
    await Promise.all(answersForPrompt.map(
        (reply) => answersShortCircuitHook.add(reply)));
    const conclusionPrompt = MODEL_CONCLUSION_PROMPT(promptOptions, answersForPrompt, query, recursedNote, recursedQuery);
    log.log('research: conclusion prompt', {correlationId, docId, conclusionPrompt});
    const conclusionTimer = time.timer();
    const {content: conclusion, usage} = await common.chatWithRetry(
        correlationId, null, conclusionPrompt, CONCLUSION_TOKEN_COUNT_LIMIT, answersShortCircuitHook, null, warnings);
    const elapsedConclusion = conclusionTimer.elapsed();
    return {
        state: 'success',
        reply: conclusion,
        options: {options, promptOptions},
        actions: answers,
        tokenCounts: {
            recursedNote: recursedNoteTokenCount,
            recursedQuery: recursedQueryTokenCount,
        },
        usage,
        cost: common.CHAT_COST.sum([...answerCosts, common.CHAT_COST(usage)]),
        timeStats: {
            elapsed: timer.elapsed(),
            elapsedConclusion,
        },
        warnings: warnings.get(),
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

const getUrls = async (correlationId, docId, uuleCanonicalName, q, warnings) => {
    try {
        const {data: search, resultsCount} =
            await common.serpSearchWithRetry(correlationId, q, uuleCanonicalName || null);
        if (!search) {
            log.log('research: get urls: no result', {correlationId, docId, q});
            return [];
        }
        if (resultsCount < SEARCH_MIN_RESULTS_COUNT) {
            log.log('research: get urls: results count too low', {correlationId, docId, q, resultsCount});
            return [];
        }
        return serp.getOrganicLinks(search);
    } catch (e) {
        warnings.strong('research: get urls: failed', {correlationId, docId, q}, e);
        return [];
    }
};

const getAnswer = async (correlationId, docId, query, recursedNote, recursedQuery, url, promptOptions) => {
    log.log('research: get answer: parameters',
        {correlationId, docId, query, recursedNote, recursedQuery, url, promptOptions});
    const warnings = common.warnings();
    let input = '';
    let reply = '';
    let inputTokenCount = 0;
    let usage = chat.EMPTY_USAGE();
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
                const answerPrompt = MODEL_ANSWER_PROMPT(promptOptions, input, query, recursedNote, recursedQuery);
                log.log('research: get answer: answer prompt', {correlationId, docId, url, answerPrompt});
                const {content: reply_, usage: usage_} = await common.chatWithRetry(
                    correlationId, null, answerPrompt, ANSWER_TOKEN_COUNT_LIMIT, null, null, warnings);
                reply = reply_;
                usage = usage_;
            }
        }
    } catch (e) {
        warnings('research: get answer: failed',
            {correlationId, docId, query, recursedNote, recursedQuery, url}, e);
    }
    return {
        reply,
        data: {
            input,
            tokenCounts: {
                ...(!inputTokenCount ? {} : {input: inputTokenCount}),
            },
            usage,
            cost: common.CHAT_COST(usage),
            warnings: warnings.get(),
        },
    };
};

const combineUrls = (a, b) => {
    const o = [];
    const seen = new Set();
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (i < a.length && !seen.has(a[i])) {
            o.push(a[i]);
            seen.add(a[i]);
        }
        if (i < b.length && !seen.has(b[i])) {
            o.push(b[i]);
            seen.add(b[i]);
        }
    }
    return o;
};

export default {
    research,
};
