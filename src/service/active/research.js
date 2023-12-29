import tokenizer from '../../repository/llm/tokenizer.js';
import chat from '../../repository/llm/chat.js';
import serp from '../../repository/web/serp.js';
import memory from '../../repository/db/memory.js';
import commonActive from './common.js';
import common from '../common.js';
import number from '../../util/number.js';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';
import time from '../../util/time.js';

const MODEL_SCORE_PROMPT_SITE_DATA = ({link = null, source = null, title = null, snippet = null}) => {
    const o = {};
    if (source) o.info = source;
    if (link) o.url = link;
    if (title) o.title = title;
    if (snippet) o.content = snippet;
    return o;
};
const MODEL_SCORE_PROMPT = (promptOptions, siteData, query, recursedNote, recursedQuery) =>
    common.MODEL_PROMPT_CORE_MSG
    + `\n${common.MODEL_PROMPT_INTERNAL_COMPONENT_MSG}`
    + `\n${common.MODEL_PROMPT_OPTIONS_PART(promptOptions)}`
    + `\nsite data: ${JSON.stringify(siteData)}`
    + `\nquery: ${JSON.stringify(query)}`
    + (!recursedNote ? '' : `\ninternal recursed note: ${JSON.stringify(recursedNote)}`)
    + `\ninternal recursed query: ${JSON.stringify(recursedQuery)}`
    + `\nscore relevance of site, with JSON {reason, score}, range 0-10`;
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
const SCORE_TOKEN_COUNT_LIMIT = strictParse.int(process.env.RESEARCH_SCORE_TOKEN_COUNT_LIMIT);
const SCORE_IDX_OVERRIDE_COUNT = strictParse.int(process.env.RESEARCH_SCORE_IDX_OVERRIDE_COUNT);
const SITE_SCORE = (rand, score, idx) => {
    if (idx < SCORE_IDX_OVERRIDE_COUNT) return 10 + SCORE_IDX_OVERRIDE_COUNT - idx;
    if (score < 0) score = 0;
    else if (score > 10) score = 10;
    return Math.exp(Math.log(score / 10) * rand) * 10;
};
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
    const actionLvl = queryInfo.recursedQueryStack.length + 1;
    const timer = time.timer();
    const {recursedNoteTokenCount, recursedQueryTokenCount} =
        await getTokenCounts(correlationId, docId, recursedNote, recursedQuery);
    const uuleCanonicalName = await uuleCanonicalNameTask;
    const sites_ = combineSites(...await Promise.all([
        getSites(correlationId, docId, uuleCanonicalName, recursedQuery, warnings),
        (async () => {
            if (backupRecursedQuery === recursedQuery) {
                return [];
            }
            return await getSites(correlationId, docId, uuleCanonicalName, backupRecursedQuery, warnings);
        })(),
    ]));
    const sites = sites_.filter(({link}) => !link.endsWith('.pdf'));
    log.log('research: sites', {correlationId, docId, sites, sites_});
    if (!sites.length) {
        return {
            state: 'no-sites',
            reply: null,
            options: {options},
            timeStats: {
                elapsed: timer.elapsed(),
            },
            warnings: warnings.get(),
        };
    }
    const promptOptions = await promptOptionsTask;
    const scoreTimer = time.timer();
    const scores_ = await Promise.all(sites.map((siteData, idx) => getSiteScore(
        correlationId, docId, siteData, idx, queryInfo, promptOptions, warnings)
        .then((o) => ({...o, ...siteData}))));
    const elapsedScore = scoreTimer.elapsed();
    const scoreUsages = scores_.map(({usage}) => usage);
    const scores = scores_.map(({score}, idx) => SITE_SCORE(Math.random(), score, idx));
    log.log('research: scores', {correlationId, docId, scores, scores_});
    // NB: sort is stable, which is needed in case of scores of 10
    const urls = sites.map(({link}, idx) => ({link, score: scores[idx]}))
        .sort(({score: a}, {score: b}) => b - a).map(({link}) => link);
    log.log('research: urls', {correlationId, docId, urls});
    const answerTaskCount = Math.min(URL_COUNT, sites.length);
    const answerCosts = [];
    let availableI = answerTaskCount;
    const rawAnswerTasks = [...Array(answerTaskCount).keys()].map((i) => (async () => {
        const answerTimer = time.timer();
        let currI = i;
        let reply = '';
        let data = null;
        for (let j = 0; j <= RETRY_NEW_URL_COUNT; j++) {
            const o = await getAnswer(
                correlationId, docId, queryInfo, urls[currI], promptOptions);
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
            urlIdx: currI,
            url: urls[currI],
            timeStats: {
                elapsed: answerTimer.elapsed(),
            },
        };
    })());
    const answers = await Promise.all(rawAnswerTasks.map((task) => task.then(async (res) => {
            const {reply, data, urlIdx, url, timeStats} = res;
            answerCosts.push(data?.cost || null);
            if (!reply) {
                return {
                    reply,
                    urlIdx,
                    url,
                    timeStats,
                };
            }
            const actiobDbExtra = {
                correlationId,
                ...data,
                urlIdx,
                url,
                timeStats,
            };
            const {index, timestamp} = await memory.addAction(correlationId, docId, actionLvl, {
                [common.KIND_FIELD]: ACTION_KIND_ANSWER,
                [common.RECURSED_NOTE_FIELD]: recursedNote || '',
                [common.RECURSED_QUERY_FIELD]: recursedQuery,
                [common.REPLY_FIELD]: reply,
            }, actiobDbExtra).catch((e) => {
                warnings.strong('research: add answer failed', {correlationId, docId}, e);
                return {index: null, timestamp: null};
            });
            return {
                reply,
                urlIdx,
                url,
                timeStats,
                index,
                timestamp,
            };
        })
    ));
    const answersForPrompt = answers.filter(({reply}) => reply)
        .sort(({urlIdx: a}, {urlIdx: b}) => a - b).map(({reply}) => reply);
    if (!answersForPrompt.length) {
        return {
            state: 'no-answers',
            reply: null,
            options: {options, promptOptions},
            scoreUsages,
            cost: common.CHAT_COST.sum(scoreUsages.map(common.CHAT_COST)),
            timeStats: {
                elapsed: timer.elapsed(),
                elapsedScore,
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
        correlationId, null, conclusionPrompt, {maxTokens: CONCLUSION_TOKEN_COUNT_LIMIT},
        answersShortCircuitHook, null, warnings);
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
        scoreUsages,
        cost: common.CHAT_COST.sum([...answerCosts, common.CHAT_COST(usage), ...scoreUsages.map(common.CHAT_COST)]),
        timeStats: {
            elapsed: timer.elapsed(),
            elapsedScore,
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

const getSites = async (correlationId, docId, uuleCanonicalName, q, warnings) => {
    try {
        const {data: search, resultsCount} =
            await common.serpSearchWithRetry(correlationId, q, uuleCanonicalName || null);
        if (!search) {
            log.log('research: get sites: no result', {correlationId, docId, q});
            return [];
        }
        if (resultsCount < SEARCH_MIN_RESULTS_COUNT) {
            log.log('research: get sites: results count too low', {correlationId, docId, q, resultsCount});
            return [];
        }
        return serp.getOrganicLinks(search);
    } catch (e) {
        warnings.strong('research: get sites: failed', {correlationId, docId, q}, e);
        return [];
    }
};

const getSiteScore = async (correlationId, docId, siteData, idx, queryInfo, promptOptions, warnings) => {
    if (idx < SCORE_IDX_OVERRIDE_COUNT) {
        return {score: null, reason: `score not used for idx ${idx}`, usage: chat.EMPTY_USAGE()};
    }
    const {query, recursedNote, recursedQuery} = queryInfo;
    let score = null;
    let reason = null;
    let usage = chat.EMPTY_USAGE();
    try {
        const scorePrompt = MODEL_SCORE_PROMPT(
            promptOptions, MODEL_SCORE_PROMPT_SITE_DATA(siteData), query, recursedNote, recursedQuery);
        log.log('research: get site score: score prompt', {correlationId, docId, scorePrompt});
        const {content: reply, usage: usage_} = await common.chatWithRetry(
            correlationId, null, scorePrompt, {maxTokens: SCORE_TOKEN_COUNT_LIMIT, jsonMode: true},
            null, null, warnings);
        usage = usage_;
        const {reason: reason_, score: score_} = JSON.parse(reply);
        reason = reason_;
        score = number.orNull(score_);
    } catch (e) {
        warnings('research: get site score: failed', {correlationId, docId, siteData, queryInfo}, e);
    }
    return {score, reason, usage};
};

const getAnswer = async (correlationId, docId, queryInfo, url, promptOptions) => {
    log.log('research: get answer: parameters',
        {correlationId, docId, queryInfo, url, promptOptions});
    const {query, recursedNote, recursedQuery} = queryInfo;
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
                    correlationId, null, answerPrompt, {maxTokens: ANSWER_TOKEN_COUNT_LIMIT},
                    null, null, warnings);
                reply = reply_;
                usage = usage_;
            }
        }
    } catch (e) {
        warnings('research: get answer: failed',
            {correlationId, docId, queryInfo, url}, e);
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

const combineSites = (a, b) => {
    const o = [];
    const seenLinks = new Set();
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (i < a.length && !seenLinks.has(a[i].link)) {
            o.push(a[i]);
            seenLinks.add(a[i].link);
        }
        if (i < b.length && !seenLinks.has(b[i].link)) {
            o.push(b[i]);
            seenLinks.add(b[i].link);
        }
    }
    return o;
};

export default {
    research,
};
