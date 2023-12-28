import * as uuid from 'uuid';
import revision from './revision.js';
import host from '../../repository/devops/host.js';
import tokenizer from '../../repository/llm/tokenizer.js';
import memory from '../../repository/db/memory.js';
import commonActive from './common.js';
import common from '../common.js';
import common_ from '../../common.js';
import fetch_ from '../../util/fetch.js';
import cache from '../../util/cache.js';
import number from '../../util/number.js';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';
import time from '../../util/time.js';
import error from '../../util/error.js';

const QUERY_INTERNAL_URL = (baseUrl) => `${baseUrl}${common_.QUERY_INTERNAL_ROUTE}`;
const RESEARCH_INTERNAL_URL = (baseUrl) => `${baseUrl}${common_.RESEARCH_INTERNAL_ROUTE}`;
const CONSOLIDATE_INTERNAL_URL = (baseUrl) => `${baseUrl}${common_.CONSOLIDATE_INTERNAL_ROUTE}`;
const INTROSPECT_INTERNAL_URL = (baseUrl) => `${baseUrl}${common_.INTROSPECT_INTERNAL_ROUTE}`;
const MODEL_PROMPT_RECURSED_NOTE_FIELD = 'recursedNote';
const MODEL_PROMPT_RECURSED_QUERY_FIELD = 'recursedQuery';
const MODEL_PROMPT_SCORE_FIELD = 'score';
const MODEL_PROMPT_QUERY_FIELD = 'query';
const MODEL_PROMPT_REPLY_FIELD = 'reply';
const MODEL_PROMPT_SUMMARY_FIELD = 'summary';
const MODEL_PROMPT_INTROSPECTION_FIELD = 'introspection';
const MODEL_PROMPT_IMAGINATION_FIELD = 'imagination';
const MODEL_PROMPT = (promptOptions, info, search, actionHistory, actions, longTermContext, shortTermContext, query, recursedNote, recursedQuery) =>
    common.MODEL_PROMPT_CORE_MSG
    + `\n${!recursedQuery ? common.MODEL_PROMPT_EXTERNAL_COMPONENT_MSG : common.MODEL_PROMPT_INTERNAL_COMPONENT_MSG}`
    + `\n${common.MODEL_PROMPT_OPTIONS_PART(promptOptions)}`
    + (!info ? '' : `\ninternal information: ${info}`)
    + (!search ? '' : `\ninternal search: ${search}`)
    + `\ninternal action history, unknown to user: ${JSON.stringify(actionHistory)}`
    + (!actions.length ? '' : `\ninternal actions, unknown to user: ${JSON.stringify(actions)}`)
    + `\nlong-term context: ${JSON.stringify(longTermContext)}`
    + `\nshort-term context: ${JSON.stringify(shortTermContext)}`
    + `\nquery: ${JSON.stringify(query)}`
    + (!recursedNote ? '' : `\ninternal recursed note: ${JSON.stringify(recursedNote)}`)
    // NB: not duplicate when recursing to same query
    + ((!recursedQuery || recursedQuery === query) ? '' : `\ninternal recursed query: ${JSON.stringify(recursedQuery)}`)
    + `\nreply`;
const MODEL_FUNCTION_NAME = 'act';
const MODEL_FUNCTION_KIND_ARG_NAME = 'kind';
const MODEL_FUNCTION_RECURSED_NOTE_ARG_NAME = 'recursedNote';
const MODEL_FUNCTION_RECURSED_QUERY_ARG_NAME = 'recursedQuery';
const MODEL_FUNCTION_RECURSED_QUERY_ARG_NAME_IS_POSSIBLE_TYPO = (k) => k.endsWith('Query');
const MODEL_FUNCTION_KIND_THINK = 'think';
const MODEL_FUNCTION_KIND_RESEARCH = 'research';
const MODEL_FUNCTION_KIND_REPLY = 'reply'; // NB: way out to not launch subtask
const MODEL_FUNCTION_KINDS = [MODEL_FUNCTION_KIND_THINK, MODEL_FUNCTION_KIND_RESEARCH, MODEL_FUNCTION_KIND_REPLY];
const MODEL_FUNCTION = {
    VAL: {
        name: MODEL_FUNCTION_NAME,
        description: '',
        parameters: {
            type: 'object',
            properties: {
                [MODEL_FUNCTION_RECURSED_NOTE_ARG_NAME]: {type: 'string', description: 'thoughts'},
                [MODEL_FUNCTION_RECURSED_QUERY_ARG_NAME]:
                    {type: 'string', description: 'search query, for search engine'},
                [MODEL_FUNCTION_KIND_ARG_NAME]: {type: 'string', enum: MODEL_FUNCTION_KINDS},
            },
            required: [MODEL_FUNCTION_RECURSED_NOTE_ARG_NAME, MODEL_FUNCTION_RECURSED_QUERY_ARG_NAME, MODEL_FUNCTION_KIND_ARG_NAME],
        },
    }, TOKEN_COUNT: 59,
};
const QUERY_TOKEN_COUNT_LIMIT = strictParse.int(process.env.QUERY_QUERY_TOKEN_COUNT_LIMIT);
const RECURSED_NOTE_TOKEN_COUNT_LIMIT = strictParse.int(process.env.QUERY_RECURSED_NOTE_TOKEN_COUNT_LIMIT);
const RECURSED_QUERY_TOKEN_COUNT_LIMIT = strictParse.int(process.env.QUERY_RECURSED_QUERY_TOKEN_COUNT_LIMIT);
const INFO_TRUNCATION_TOKEN_COUNT = strictParse.int(process.env.QUERY_INFO_TRUNCATION_TOKEN_COUNT);
const SEARCH_MIN_RESULTS_COUNT = strictParse.int(process.env.QUERY_SEARCH_MIN_RESULTS_COUNT);
const SEARCH_TRUNCATION_TOKEN_COUNT = strictParse.int(process.env.QUERY_SEARCH_TRUNCATION_TOKEN_COUNT);
const ACTION_HISTORY_COUNT = strictParse.int(process.env.QUERY_ACTION_HISTORY_COUNT);
const MAX_ITERS_WITH_ACTIONS = strictParse.json(process.env.QUERY_MAX_ITERS_WITH_ACTIONS);
const CTX_SCORE_FIRST_ITEMS_COUNT = strictParse.int(process.env.QUERY_CTX_SCORE_FIRST_ITEMS_COUNT);
const CTX_SCORE_FIRST_ITEMS_MAX_VAL = strictParse.float(process.env.QUERY_CTX_SCORE_FIRST_ITEMS_MAX_VAL);
const CTX_SCORE_FIRST_ITEMS_LINEAR_DECAY = strictParse.float(process.env.QUERY_CTX_SCORE_FIRST_ITEMS_LINEAR_DECAY);
const CTX_SCORE_REST_ITEMS_MULT_FACTOR = strictParse.float(process.env.QUERY_CTX_SCORE_REST_ITEMS_MULT_FACTOR);
const CTX_SCORE_REST_ITEMS_IDX_OFFSET = strictParse.float(process.env.QUERY_CTX_SCORE_REST_ITEMS_IDX_OFFSET);
const CTX_SCORE_REST_ITEMS_IDX_DECAY_EXPONENT = strictParse.float(process.env.QUERY_CTX_SCORE_REST_ITEMS_IDX_DECAY_EXPONENT);
const CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MULT_FACTOR = strictParse.float(process.env.QUERY_CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MULT_FACTOR);
const CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MS_VAL = strictParse.float(process.env.QUERY_CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_HOUR_VAL) / time.HOUR;
const CTX_SCORE = (i, ms, getSim) => {
    if (i < CTX_SCORE_FIRST_ITEMS_COUNT) {
        return CTX_SCORE_FIRST_ITEMS_MAX_VAL - CTX_SCORE_FIRST_ITEMS_LINEAR_DECAY * i;
    }
    const idxTimePenalty = CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MULT_FACTOR * Math.log(CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MS_VAL * ms + 1);
    return CTX_SCORE_REST_ITEMS_MULT_FACTOR * (i + CTX_SCORE_REST_ITEMS_IDX_OFFSET + idxTimePenalty) ** -CTX_SCORE_REST_ITEMS_IDX_DECAY_EXPONENT * getSim();
};
const SHORT_TERM_CONTEXT_COUNT = strictParse.int(process.env.QUERY_SHORT_TERM_CONTEXT_COUNT);
const LONG_TERM_CONTEXT_COUNT = strictParse.int(process.env.QUERY_LONG_TERM_CONTEXT_COUNT);
const HISTORY_COUNT = strictParse.int(process.env.QUERY_HISTORY_COUNT);
const SHORT_CIRCUIT_TO_ACTION_OVERLAPPING_TOKENS = strictParse.int(process.env.QUERY_SHORT_CIRCUIT_TO_ACTION_OVERLAPPING_TOKENS);
const REPLY_TOKEN_COUNT_LIMIT = strictParse.int(process.env.QUERY_REPLY_TOKEN_COUNT_LIMIT);
const RECURSION_TIMEOUT = strictParse.int(process.env.QUERY_RECURSION_TIMEOUT_SECS) * time.SECOND;
const MIN_SCHEDULED_IMAGINATION_DELAY = strictParse.int(process.env.QUERY_MIN_SCHEDULED_IMAGINATION_DELAY_MINUTES) * time.MINUTE;
const MAX_SCHEDULED_IMAGINATION_DELAY = strictParse.int(process.env.QUERY_MAX_SCHEDULED_IMAGINATION_DELAY_MINUTES) * time.MINUTE;

const query = wrapper.logCorrelationId('service.active.query.query', async (correlationId, onPartial, userId, sessionId, options, queryInfo) => {
    log.log('query: parameters',
        {correlationId, userId, sessionId, options, queryInfo});
    const {query, recursedNote, recursedQuery} = queryInfo;
    const warnings = common.warnings();
    const baseUrlTask = host.getBaseUrl(correlationId).then((baseUrl) => {
        log.log('query: base url', {correlationId, baseUrl});
        return baseUrl;
    }).catch((_) => '');
    const ipGeolocateTask = commonActive.ipGeolocate(correlationId, options, 'query');
    const uuleCanonicalNameTask = commonActive.uuleCanonicalName(correlationId, ipGeolocateTask, warnings, 'query');
    const promptOptionsTask = commonActive.promptOptions(correlationId, options, ipGeolocateTask, warnings, 'query');
    const docId = common.DOC_ID.from(userId, sessionId);
    const actionLvl = !recursedQuery ? 0 : queryInfo.recursedQueryStack.length + 1;
    const timer = time.timer();
    const {queryTokenCount, recursedNoteTokenCount, recursedQueryTokenCount} =
        await getTokenCounts(correlationId, docId, query, recursedNote, recursedQuery);
    const [
        {info, infoTokenCount, selectedQ: infoSelectedQ},
        {search, searchTokenCount, selectedQ: searchSelectedQ},
        {actionHistory},
        {queryEmbedding, shortTermContext, longTermContext},
    ] = await Promise.all([
        // NB: do info and search only on recursion
        (async () => {
            if (!recursedQuery) {
                return {info: '', infoTokenCount: 0, selectedQ: null};
            }
            return await getInfo(correlationId, docId, options, queryInfo, warnings);
        })(),
        (async () => {
            if (!recursedQuery) {
                return {search: '', searchTokenCount: 0, selectedQ: null};
            }
            return await getSearch(correlationId, docId, queryInfo, uuleCanonicalNameTask, warnings);
        })(),
        getActionHistory(correlationId, docId, actionLvl),
        (async () => {
            const {embedding: queryEmbedding} = await common.embedWithRetry(correlationId, query);
            let recursedQueryEmbedding = null;
            if (!(!recursedQuery || recursedQuery === query)) {
                const {embedding: recursedQueryEmbedding_} = await common.embedWithRetry(correlationId, recursedQuery);
                recursedQueryEmbedding = recursedQueryEmbedding_;
            }
            // NB: harmonic mean
            const doSim = !recursedQueryEmbedding
                ? (f) => f(queryEmbedding)
                : (f) => {
                    const q = f(queryEmbedding);
                    const rq = f(recursedQueryEmbedding);
                    return (2 * q * rq) / (q + rq) || 0;
                };
            const [
                {shortTermContext},
                {longTermContext},
            ] = await Promise.all([
                getShortTermContext(correlationId, docId, timer, doSim),
                getLongTermContext(correlationId, docId, doSim),
            ]);
            return {queryEmbedding, shortTermContext, longTermContext};
        })(),
    ]);
    const promptOptions = await promptOptionsTask;
    const onPartialChat =
        !onPartial ? null : ({content}) => onPartial({event: 'reply', content});
    const getHistoryCached = wrapper.cache(cache.lruTtl(1, 30 * time.MINUTE), () => '',
        () => getHistory(correlationId, docId));
    const actions = [];
    const actionsForRevision = [];
    const actionsForPrompt = [];
    const actionCosts = [];
    const confidences = [];
    const prompts = [];
    const elapsedChats = [];
    const usages = [];
    const elapsedFunctionCalls = [];
    const functionCalls = [];
    const actionsShortCircuitHook = common.shortCircuitAutocompleteContentHook(
        correlationId, SHORT_CIRCUIT_TO_ACTION_OVERLAPPING_TOKENS);
    let reply = '';
    let i = 0;
    const maxItersWithActions = MAX_ITERS_WITH_ACTIONS[actionLvl] || 0;
    let isFinalIter = !maxItersWithActions;
    while (true) {
        const localPrompt = MODEL_PROMPT(
            promptOptions, info, search, actionHistory, [...actionsForPrompt].reverse(), longTermContext, shortTermContext, query, recursedNote, recursedQuery);
        prompts.push(localPrompt)
        log.log(`query: iter ${i}: prompt`, {correlationId, docId, i, localPrompt});
        // NB: cannot reliably use confidence value
        const probeTask = (async () => {
            if (!isFinalIter) {
                const {confidence, usage: localProbeUsage}
                    = await probeConfidence(correlationId, docId, localPrompt, warnings);
                confidences.push(confidence);
                if (confidence !== null) {
                    usages.push({iter: i, step: 'main-probe', ...localProbeUsage});
                }
            }
        })();
        const localChatTimer = time.timer();
        const {content: localReply, functionCalls: localFunctionCalls, usage: localUsage} = await common.chatWithRetry(
            correlationId, onPartialChat, localPrompt, {maxTokens: REPLY_TOKEN_COUNT_LIMIT},
            actionsShortCircuitHook, !isFinalIter ? MODEL_FUNCTION : null, warnings);
        elapsedChats.push(localChatTimer.elapsed());
        usages.push({iter: i, step: 'main', ...localUsage});
        await probeTask;
        if (!localFunctionCalls.length) {
            reply = localReply;
            break;
        }
        log.log(`query: iter ${i}: function call: function calls`, {correlationId, docId, i, localFunctionCalls});
        if (localReply) {
            log.log(`query: iter ${i}: function call: model also replied; discard`,
                {correlationId, docId, i, localReply});
        }
        const cleanedLocalFunctionCalls = await Promise.all(localFunctionCalls.map((call) =>
            cleanFunctionCall(correlationId, docId, i, call)));
        const localFunctionCallsTimer = time.timer();
        const elapsedLocalFunctionCallRevisions = [];
        const revisedLocalFunctionCalls = [];
        const rawLocalActionTasks = [];
        for (const [j, {args}] of cleanedLocalFunctionCalls.entries()) {
            const {
                [MODEL_FUNCTION_KIND_ARG_NAME]: kind,
                [MODEL_FUNCTION_RECURSED_NOTE_ARG_NAME]: recursedNextNote,
                [MODEL_FUNCTION_RECURSED_QUERY_ARG_NAME]: recursedNextQuery,
            } = args;
            if (!MODEL_FUNCTION_KINDS.includes(kind) || !recursedNextQuery) {
                log.log(`query: iter ${i}: function call: invalid args`, {correlationId, docId, i, args});
                continue;
            }
            const revisionData = await revise(
                correlationId, docId, kind, {query, recursedNote: recursedNextNote, recursedQuery: recursedNextQuery},
                getHistoryCached, actionsForRevision, promptOptions, warnings);
            if (revisionData.reply) {
                usages.push({iter: i, subIter: j, step: 'revision', ...revisionData.usage});
                elapsedLocalFunctionCallRevisions.push({subIter: j, ...revisionData.timeStats});
            }
            const recursedNextQuery_ = revisionData.reply || recursedNextQuery;
            revisedLocalFunctionCalls.push({revisedRecursedQuery: recursedNextQuery_});
            if (queryInfo.recursedQueryStack?.includes(recursedNextQuery_)) {
                log.log(`query: iter ${i}, subiter ${j}: function call: duplicate with recursed query stack`,
                    {correlationId, docId, i, j, args});
                continue;
            }
            if (functionCalls.some(({v: calls}) => calls.some(({args, revisedRecursedQuery}) =>
                args[MODEL_FUNCTION_KIND_ARG_NAME] === kind
                && revisedRecursedQuery === recursedNextQuery_))) {
                log.log(`query: iter ${i}, subiter ${j}: function call: duplicate with previous iters`,
                    {correlationId, docId, i, j, args});
                continue;
            }
            if (actionHistory.some((action) =>
                (recursedNextNote && action[MODEL_PROMPT_RECURSED_NOTE_FIELD] === recursedNextNote)
                && action[MODEL_PROMPT_RECURSED_QUERY_FIELD] === recursedNextQuery_)) {
                log.log(`query: iter ${i}, subiter ${j}: function call: duplicate with action history`,
                    {correlationId, docId, i, j, args});
                continue;
            }
            if (onPartial) {
                onPartial({event: 'task-start', kind});
            }
            rawLocalActionTasks.push((async () => {
                let actionFn;
                switch (kind) {
                    case MODEL_FUNCTION_KIND_THINK:
                        actionFn = thinkAction;
                        break;
                    case MODEL_FUNCTION_KIND_RESEARCH:
                        actionFn = researchAction;
                        break;
                    case MODEL_FUNCTION_KIND_REPLY:
                        actionFn = replyAction;
                        break;
                }
                const nextQueryInfo = {
                    query,
                    recursedQueryStack: !recursedQuery ? [] : [...queryInfo.recursedQueryStack, recursedQuery],
                    recursedNote: recursedNextNote,
                    backupRecursedQuery: recursedNextQuery,
                    recursedQuery: recursedNextQuery_,
                };
                const {reply: reply_, data: data_} = await actionFn(
                    correlationId, docId, options, nextQueryInfo, baseUrlTask, warnings);
                const reply = reply_ || null;
                const data = data_ || null;
                if (data?.warnings) {
                    warnings.merge(data?.warnings);
                }
                return {
                    reply,
                    data,
                    kind,
                    recursedNextNote,
                    backupRecursedNextQuery: recursedNextQuery,
                    recursedNextQuery: recursedNextQuery_,
                };
            })());
        }
        // NB: exclude data field due to firestore size limit
        const localActions = await Promise.all(rawLocalActionTasks.map((task) => task.then(async (res) => {
            const {reply, data, kind, recursedNextNote, backupRecursedNextQuery, recursedNextQuery} = res;
            actionCosts.push(data?.cost || null);
            if (!reply || kind === MODEL_FUNCTION_KIND_REPLY) {
                return {
                    reply,
                    kind,
                    recursedNextNote,
                    backupRecursedNextQuery,
                    recursedNextQuery,
                };
            }
            if (onPartial) {
                onPartial({event: 'task', kind});
            }
            const actiobDbExtra = {
                correlationId,
                backupRecursedNextQuery,
                ...data,
            };
            const {index, timestamp} = await memory.addAction(correlationId, docId, actionLvl, {
                [common.KIND_FIELD]: kind,
                [common.RECURSED_NOTE_FIELD]: recursedNextNote || '',
                [common.RECURSED_QUERY_FIELD]: recursedNextQuery,
                [common.REPLY_FIELD]: reply,
            }, actiobDbExtra).catch((e) => {
                warnings.strong(`query: iter ${i}: function call: add action failed`,
                    {correlationId, docId, i, actionLvl}, e);
                return {index: null, timestamp: null};
            });
            return {
                reply,
                kind,
                recursedNextNote,
                backupRecursedNextQuery,
                recursedNextQuery,
                index,
                timestamp,
            };
        })));
        const localActions_ = localActions.filter(({reply}) => reply);
        actions.push({v: localActions});
        actionsForRevision.push(localActions_.map(({kind, recursedNextNote, recursedNextQuery, reply}) => ({
            [revision.MODEL_PROMPT_KIND_FIELD]: kind,
            [revision.MODEL_PROMPT_RECURSED_NOTE_FIELD]: recursedNextNote,
            [revision.MODEL_PROMPT_RECURSED_QUERY_FIELD]: recursedNextQuery,
            [revision.MODEL_PROMPT_REPLY_FIELD]: reply,
        })));
        // NB: exclude fields to not influence further actions
        actionsForPrompt.push(...localActions_.map(({reply}) => ({[MODEL_PROMPT_REPLY_FIELD]: reply})));
        elapsedFunctionCalls.push({
            total: localFunctionCallsTimer.elapsed(),
            revisions: elapsedLocalFunctionCallRevisions,
        });
        functionCalls.push({v: localFunctionCalls.map((v, j) => ({...v, ...revisedLocalFunctionCalls[j]}))});
        await Promise.all(localActions_.map(
            ({reply}) => actionsShortCircuitHook.add(reply)));
        if (!localActions_.length) {
            log.log(`query: iter ${i}: function call: no result`, {correlationId, docId, i});
            isFinalIter = true;
        }
        if (localActions.some(({kind}) => kind === MODEL_FUNCTION_KIND_REPLY)) {
            log.log(`query: iter ${i}: function call: has reply action`, {correlationId, docId, i});
            isFinalIter = true;
        }
        if (i >= maxItersWithActions - 1) {
            log.log(`query: iter ${i}: function call: at max iters`, {correlationId, docId, i});
            isFinalIter = true;
        }
        i++;
    }
    const extra = {
        correlationId,
        options: {options, promptOptions},
        ...(!info ? {} : {info}),
        ...(!infoSelectedQ ? {} : {infoSelectedQ}),
        ...(!search ? {} : {search}),
        ...(!searchSelectedQ ? {} : {searchSelectedQ}),
        actionHistory,
        shortTermContext,
        longTermContext,
        functionCalls,
        actions,
        confidences,
        tokenCounts: {
            ...(!queryTokenCount ? {} : {query: queryTokenCount}),
            ...(!recursedNoteTokenCount ? {} : {recursedNote: recursedNoteTokenCount}),
            ...(!recursedQueryTokenCount ? {} : {recursedQuery: recursedQueryTokenCount}),
            ...(!infoTokenCount ? {} : {info: infoTokenCount}),
            ...(!searchTokenCount ? {} : {search: searchTokenCount}),
        },
        usages,
        cost: common.CHAT_COST.sum([...actionCosts, ...usages.map(common.CHAT_COST)]),
        timeStats: {
            elapsed: timer.elapsed(),
            elapsedChats,
            elapsedFunctionCalls,
        },
    };
    if (recursedQuery) {
        return {
            reply,
            ...extra,
            warnings: warnings.get(),
        };
    }
    const [
        {index, timestamp},
        {scheduledImagination},
    ] = await Promise.all([
        (async () => {
            const {embedding: replyEmbedding} = await common.embedWithRetry(correlationId, reply);
            const dbExtra = {
                ...extra,
                prompts,
                warnings: warnings.get(),
            };
            return await memory.add(correlationId, docId, {
                [common.QUERY_FIELD]: query,
                [common.QUERY_EMBEDDING_FIELD]: queryEmbedding,
                [common.REPLY_FIELD]: reply,
                [common.REPLY_EMBEDDING_FIELD]: replyEmbedding,
            }, dbExtra, false);
        })().catch((e) => {
            warnings.strong('query: add failed', {correlationId, docId}, e);
            return {index: null, timestamp: null};
        }),
        setScheduledImagination(correlationId, docId, warnings),
    ]);
    if (index !== null) {
        await triggerBackgroundTasks(correlationId, docId, index, baseUrlTask, warnings);
    }
    return {
        index,
        timestamp,
        reply,
        ...extra,
        scheduledImagination,
        warnings: warnings.get(),
    };
});

const getTokenCounts = async (correlationId, docId, query, recursedNote, recursedQuery) => {
    let queryTokenCount = 0;
    let recursedNoteTokenCount = 0;
    let recursedQueryTokenCount = 0;
    if (!recursedQuery) {
        queryTokenCount = await tokenizer.countTokens(correlationId, query);
        log.log('query: query token count', {correlationId, docId, queryTokenCount});
        if (queryTokenCount > QUERY_TOKEN_COUNT_LIMIT) {
            throw new Error(`query: query token count exceeds limit: ${queryTokenCount} > ${QUERY_TOKEN_COUNT_LIMIT}`);
        }
    } else {
        // assume query is ok
        if (recursedNote) {
            recursedNoteTokenCount = await tokenizer.countTokens(correlationId, recursedNote);
        }
        recursedQueryTokenCount = await tokenizer.countTokens(correlationId, recursedQuery);
        log.log('query: recursed note and query token counts',
            {correlationId, docId, recursedNoteTokenCount, recursedQueryTokenCount});
        if (recursedNoteTokenCount > RECURSED_NOTE_TOKEN_COUNT_LIMIT
            || recursedQueryTokenCount > RECURSED_QUERY_TOKEN_COUNT_LIMIT) {
            throw new Error('query: recursed note or query token count exceeds limit:' +
                ` ${recursedNoteTokenCount} > ${RECURSED_NOTE_TOKEN_COUNT_LIMIT} or ${recursedQueryTokenCount} > ${RECURSED_QUERY_TOKEN_COUNT_LIMIT}`);
        }
    }
    return {queryTokenCount, recursedNoteTokenCount, recursedQueryTokenCount};
};

const getInfo = async (correlationId, docId, options, queryInfo, warnings) => {
    let info = '';
    let infoTokenCount = 0;
    let selectedQ = null;
    try {
        const doInfo = async (q) => {
            try {
                const {pods} = await common.wolframAlphaQueryWithRetry(correlationId, options.ip, q);
                return !pods.length ? null : pods;
            } catch (e) {
                warnings('query: wolfram alpha query failed', {correlationId, docId, q}, e);
                return null;
            }
        };
        const candidateQueries =
            [...new Set([queryInfo.recursedQuery, queryInfo.backupRecursedQuery, queryInfo.query]
                .filter((q) => q))];
        let info_ = null;
        for (const q of candidateQueries) {
            const infoResult = await doInfo(q);
            if (infoResult) {
                info_ = infoResult;
                selectedQ = q;
                break;
            }
        }
        if (info_) {
            const {truncated, tokenCount} = await tokenizer.truncate(
                correlationId, JSON.stringify(info_), INFO_TRUNCATION_TOKEN_COUNT);
            info = truncated;
            infoTokenCount = Math.min(tokenCount, INFO_TRUNCATION_TOKEN_COUNT);
        }
    } catch (e) {
        warnings('query: get info failed', {correlationId, docId, queryInfo}, e);
    }
    log.log('query: info', {correlationId, docId, info, infoTokenCount, selectedQ});
    return {info, infoTokenCount, selectedQ};
};

const getSearch = async (correlationId, docId, queryInfo, uuleCanonicalNameTask, warnings) => {
    let search = '';
    let searchTokenCount = 0;
    let selectedQ = null;
    try {
        const uuleCanonicalName = await uuleCanonicalNameTask;
        const doSearch = async (q) => {
            try {
                const {data: search, resultsCount} =
                    await common.serpSearchWithRetry(correlationId, q, uuleCanonicalName || null);
                return {search, resultsCount};
            } catch (e) {
                warnings('query: serp search failed', {correlationId, docId, q}, e);
                return {search: null, resultsCount: 0};
            }
        };
        const candidateQueries =
            [...new Set([queryInfo.recursedQuery, queryInfo.backupRecursedQuery, queryInfo.query]
                .filter((q) => q))];
        const searchResults = [];
        for (const q of candidateQueries) {
            const searchResult = await doSearch(q);
            searchResults.push({...searchResult, q});
            if (searchResult.resultsCount >= SEARCH_MIN_RESULTS_COUNT) {
                break;
            }
        }
        const {search: search_, q: q_} = findMax(searchResults, (searchResult) => searchResult.resultsCount) ||
        {search: null, resultsCount: 0, q: null};
        if (search_) {
            const {truncated, tokenCount} = await tokenizer.truncate(
                correlationId, JSON.stringify(search_), SEARCH_TRUNCATION_TOKEN_COUNT);
            search = truncated;
            searchTokenCount = Math.min(tokenCount, SEARCH_TRUNCATION_TOKEN_COUNT);
            selectedQ = q_;
        }
    } catch (e) {
        warnings('query: get search failed', {correlationId, docId, queryInfo}, e);
    }
    log.log('query: search', {correlationId, docId, search, searchTokenCount, selectedQ});
    return {search, searchTokenCount, selectedQ};
};

const getActionHistory = async (correlationId, docId, actionLvl) => {
    const rawActionHistory = await memory.getActions(correlationId, docId, actionLvl, ACTION_HISTORY_COUNT);
    // NB: exclude kind field to reduce influence on actions
    const actionHistory = rawActionHistory.map(
        ({
             [common.RECURSED_NOTE_FIELD]: recursedNote,
             [common.RECURSED_QUERY_FIELD]: recursedQuery,
             [common.REPLY_FIELD]: reply,
         }) => ({
            [MODEL_PROMPT_RECURSED_NOTE_FIELD]: recursedNote,
            [MODEL_PROMPT_RECURSED_QUERY_FIELD]: recursedQuery,
            [MODEL_PROMPT_REPLY_FIELD]: reply,
        }));
    log.log('query: action history', {correlationId, docId, actionHistory});
    return {actionHistory};
};

const getShortTermContext = async (correlationId, docId, timer, doSim) => {
    const rawShortTermContext = await memory.shortTermSearch(correlationId, docId, (elt, i, timestamp) => {
        const ms = timer.getStart() - timestamp;
        // NB: geometric mean
        const getSim = () => {
            const {
                [common.QUERY_EMBEDDING_FIELD]: targetQueryEmbedding,
                [common.REPLY_EMBEDDING_FIELD]: replyEmbedding,
                [common.INTROSPECTION_EMBEDDING_FIELD]: introspectionEmbedding,
            } = elt;
            const f = !introspectionEmbedding
                ? (emb) => Math.sqrt(common.absCosineSimilarity(emb, targetQueryEmbedding)
                    * common.absCosineSimilarity(emb, replyEmbedding))
                : (emb) => common.absCosineSimilarity(emb, introspectionEmbedding);
            return doSim(f);
        };
        return CTX_SCORE(i, ms, getSim);
    }, SHORT_TERM_CONTEXT_COUNT);
    const shortTermContext = rawShortTermContext.map(([{
        [common.QUERY_FIELD]: query,
        [common.REPLY_FIELD]: reply,
        [common.INTROSPECTION_FIELD]: introspection,
    }, rawScore]) => {
        const score = number.round(rawScore, 3);
        return !introspection ? {
            [MODEL_PROMPT_SCORE_FIELD]: score,
            [MODEL_PROMPT_QUERY_FIELD]: query,
            [MODEL_PROMPT_REPLY_FIELD]: reply,
        } : {
            [MODEL_PROMPT_SCORE_FIELD]: score,
            [MODEL_PROMPT_INTROSPECTION_FIELD]: introspection,
        };
    }).reverse();
    log.log('query: short-term context', {correlationId, docId, shortTermContext});
    return {shortTermContext};
};

const getLongTermContext = async (correlationId, docId, doSim) => {
    const rawLongTermContext = await memory.longTermSearch(correlationId, docId, (_, consolidation) => {
        const targetEmbedding = consolidation[common.SUMMARY_EMBEDDING_FIELD] || consolidation[common.IMAGINATION_EMBEDDING_FIELD];
        const f = (emb) => common.absCosineSimilarity(emb, targetEmbedding);
        return doSim(f);
    }, LONG_TERM_CONTEXT_COUNT);
    const longTermContext = rawLongTermContext.map(([{
        [common.SUMMARY_FIELD]: summary,
        [common.IMAGINATION_FIELD]: imagination,
    },]) =>
        !imagination ? {
            [MODEL_PROMPT_SUMMARY_FIELD]: summary,
        } : {
            [MODEL_PROMPT_IMAGINATION_FIELD]: imagination,
        }).reverse();
    log.log('query: long-term context', {correlationId, docId, longTermContext});
    return {longTermContext};
};

const probeConfidence = async (correlationId, docId, prompt, warnings) => {
    try {
        const {logprobs, usage} = await common.chatWithRetry(
            correlationId, null, prompt, {maxTokens: 1, topLogprobs: 1}, null, null, warnings);
        const confidence = Math.exp((logprobs[0]?.topLogprobs || [])[0] || -Infinity);
        log.log(`query: probe confidence: ${confidence}`, {correlationId, docId, confidence});
        return {confidence, usage};
    } catch (e) {
        warnings('query: probe confidence: failed', {correlationId, docId}, e);
        return {confidence: null};
    }
};

const cleanFunctionCall = async (correlationId, docId, i, call) => {
    const {name, args: args_} = call;
    const args = args_ || {};
    if (name !== MODEL_FUNCTION_NAME) {
        log.log(`query: clean function call: invalid name: ${name}; continue`,
            {correlationId, docId, i, call});
    }
    let {
        [MODEL_FUNCTION_KIND_ARG_NAME]: kind,
        [MODEL_FUNCTION_RECURSED_NOTE_ARG_NAME]: recursedNextNote,
        [MODEL_FUNCTION_RECURSED_QUERY_ARG_NAME]: recursedNextQuery,
    } = args;
    if (kind === undefined && MODEL_FUNCTION_KINDS.includes(name)) {
        kind = name;
        log.log('query: clean function call: use fallback kind',
            {correlationId, docId, i, call, kind});
    }
    if (recursedNextQuery === undefined) {
        for (const [k, v] of Object.entries(args)) {
            if (MODEL_FUNCTION_RECURSED_QUERY_ARG_NAME_IS_POSSIBLE_TYPO(k)) {
                recursedNextQuery = v;
                log.log('query: clean function call: use fallback recursed query',
                    {correlationId, docId, i, call, recursedNextQuery});
                break;
            }
        }
    }
    const doTruncate = async (s, tokenCount) => {
        if (s.length <= tokenCount) { // common case
            return s;
        }
        const {truncated, tokenCount: initTokenCount} = await tokenizer.truncate(correlationId, s, tokenCount);
        log.log('query: clean function call: possibly truncate',
            {correlationId, docId, i, s, tokenCount, initTokenCount});
        return truncated;
    };
    const cleanRecursedNote = !recursedNextNote ? null : await doTruncate(recursedNextNote, RECURSED_NOTE_TOKEN_COUNT_LIMIT);
    const cleanRecursedQuery = !recursedNextQuery ? '' : await doTruncate(recursedNextQuery, RECURSED_QUERY_TOKEN_COUNT_LIMIT);
    const cleanArgs = {
        [MODEL_FUNCTION_KIND_ARG_NAME]: kind || '',
        [MODEL_FUNCTION_RECURSED_NOTE_ARG_NAME]: cleanRecursedNote,
        [MODEL_FUNCTION_RECURSED_QUERY_ARG_NAME]: cleanRecursedQuery,
    };
    return {name: MODEL_FUNCTION_NAME, args: cleanArgs};
};

const getHistory = async (correlationId, docId) => {
    const rawHistory = await memory.getHistory(correlationId, docId, 0, HISTORY_COUNT);
    const history = rawHistory.map(
        ({
             [common.QUERY_FIELD]: query,
             [common.REPLY_FIELD]: reply
         }) => ({
            [revision.MODEL_PROMPT_QUERY_FIELD]: query,
            [revision.MODEL_PROMPT_REPLY_FIELD]: reply,
        }));
    log.log('query: history', {correlationId, docId, history});
    return {history};
};

const revise = async (correlationId, docId, kind, queryInfo, getHistory, actions, promptOptions, warnings) => {
    if (kind !== MODEL_FUNCTION_KIND_REPLY) {
        try {
            const {history} = await getHistory();
            const data = await revision.revise(
                correlationId, docId, queryInfo, history, actions, promptOptions);
            if (data.warnings) {
                warnings.merge(data.warnings);
            }
            return data;
        } catch (e) {
            warnings.strong(`query: revise: failed`,
                {correlationId, docId, kind, queryInfo}, e);
        }
    }
    return {reply: null};
};

const thinkAction = async (correlationId, docId, options, queryInfo, baseUrlTask, warnings) => {
    const {userId, sessionId} = common.DOC_ID.parse(docId);
    const recursedCorrelationId = uuid.v4();
    log.log('query: action: think: correlation id',
        {correlationId, docId, queryInfo, recursedCorrelationId});
    try {
        const baseUrl = await baseUrlTask;
        if (!baseUrl) {
            throw new Error('query: action: think: no base url');
        }
        const resp = await fetch_.withTimeout(QUERY_INTERNAL_URL(baseUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                [common_.CORRELATION_ID_HEADER]: recursedCorrelationId,
                [common_.INTERNAL_API_ACCESS_KEY_HEADER]: common_.SECRETS.INTERNAL_API_ACCESS_KEY,
            },
            body: JSON.stringify({
                userId, sessionId, options, queryInfo,
            }),
        }, RECURSION_TIMEOUT);
        if (!resp.ok) {
            throw new Error(`query: action: think: api error, status: ${resp.status}`);
        }
        const data = await resp.json();
        log.log('query: action: think: result',
            {correlationId, docId, queryInfo, recursedCorrelationId});
        const {reply} = data;
        if (!reply) {
            warnings('query: action: think: no reply',
                {correlationId, docId, queryInfo, recursedCorrelationId});
        }
        return {reply, data};
    } catch (e) {
        warnings.strong('query: action: think: failed',
            {correlationId, docId, queryInfo, recursedCorrelationId}, e);
        return {reply: null};
    }
};

const researchAction = async (correlationId, docId, options, queryInfo, baseUrlTask, warnings) => {
    const {userId, sessionId} = common.DOC_ID.parse(docId);
    const recursedCorrelationId = uuid.v4();
    log.log('query: action: research: correlation id',
        {correlationId, docId, queryInfo, recursedCorrelationId});
    try {
        const baseUrl = await baseUrlTask;
        if (!baseUrl) {
            throw new Error('query: action: research: no base url');
        }
        const resp = await fetch_.withTimeout(RESEARCH_INTERNAL_URL(baseUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                [common_.CORRELATION_ID_HEADER]: recursedCorrelationId,
                [common_.INTERNAL_API_ACCESS_KEY_HEADER]: common_.SECRETS.INTERNAL_API_ACCESS_KEY,
            },
            body: JSON.stringify({
                userId, sessionId, options, queryInfo,
            }),
        }, RECURSION_TIMEOUT);
        if (!resp.ok) {
            throw new Error(`query: action: research: api error, status: ${resp.status}`);
        }
        const data = await resp.json();
        log.log('query: action: research: result',
            {correlationId, docId, queryInfo, recursedCorrelationId});
        const {reply} = data;
        if (!reply) {
            warnings('query: action: research: no reply',
                {correlationId, docId, queryInfo, recursedCorrelationId});
        }
        return {reply, data};
    } catch (e) {
        warnings.strong('query: action: research: failed',
            {correlationId, docId, queryInfo, recursedCorrelationId}, e);
        return {reply: null};
    }
};

const replyAction = async (correlationId, docId, options, queryInfo, baseUrlTask, warnings) => {
    const reply = queryInfo.recursedNote || '';
    return {reply};
};

const setScheduledImagination = async (correlationId, docId, warnings) => {
    return await memory.scheduleImagination(correlationId, docId, (curr) => {
        if (curr) {
            return curr;
        }
        const scheduledImagination = new Date(
            new Date().getTime() + MIN_SCHEDULED_IMAGINATION_DELAY
            + Math.random() * (MAX_SCHEDULED_IMAGINATION_DELAY - MIN_SCHEDULED_IMAGINATION_DELAY));
        log.log('query: scheduled imagination', {correlationId, docId, scheduledImagination});
        return scheduledImagination;
    }).catch((e) => {
        warnings('query: schedule imagination failed', {correlationId, docId}, e);
        return null;
    });
};

const triggerBackgroundTasks = async (correlationId, docId, index, baseUrlTask, warnings) => {
    const {userId, sessionId} = common.DOC_ID.parse(docId);
    try {
        const baseUrl = await baseUrlTask;
        if (!baseUrl) {
            throw new Error('query: trigger background tasks: no base url');
        }
        fetch_.withTimeout(CONSOLIDATE_INTERNAL_URL(baseUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                [common_.CORRELATION_ID_HEADER]: correlationId,
                [common_.INTERNAL_API_ACCESS_KEY_HEADER]: common_.SECRETS.INTERNAL_API_ACCESS_KEY,
            },
            body: JSON.stringify({userId, sessionId}),
        }, time.MINUTE).catch((e) => (e.name !== 'AbortError') &&
            log.log(`query: fetch ${common_.CONSOLIDATE_INTERNAL_ROUTE} failed`,
                {correlationId, docId, ...error.explain(e)}));
        fetch_.withTimeout(INTROSPECT_INTERNAL_URL(baseUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                [common_.CORRELATION_ID_HEADER]: correlationId,
                [common_.INTERNAL_API_ACCESS_KEY_HEADER]: common_.SECRETS.INTERNAL_API_ACCESS_KEY,
            },
            body: JSON.stringify({userId, sessionId, index}),
        }, time.MINUTE).catch((e) => (e.name !== 'AbortError') &&
            log.log(`query: fetch ${common_.INTROSPECT_INTERNAL_ROUTE} failed`,
                {correlationId, docId, ...error.explain(e)}));
    } catch (e) {
        warnings('query: trigger background tasks failed', {correlationId, docId}, e);
    }
};

const findMax = (arr, fn) => {
    let maxE = null;
    let maxV = null;
    for (const e of arr) {
        const v = fn(e);
        if (maxV === null || v > maxV) {
            maxE = e;
            maxV = v;
        }
    }
    return maxE;
};

export default {
    query,
};
