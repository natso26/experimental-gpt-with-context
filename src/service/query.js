import * as uuid from 'uuid';
import tokenizer from '../repository/tokenizer.js';
import memory from '../repository/memory.js';
import common from './common.js';
import common_ from '../common.js';
import fetch_ from '../util/fetch.js';
import strictParse from '../util/strictParse.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';
import time from '../util/time.js';

const QUERY_INTERNAL_URL = `${process.env.INTERNAL_API_HOST}${common_.QUERY_INTERNAL_ROUTE}`;
const RESEARCH_INTERNAL_URL = `${process.env.INTERNAL_API_HOST}${common_.RESEARCH_INTERNAL_ROUTE}`;
const CONSOLIDATE_INTERNAL_URL = `${process.env.INTERNAL_API_HOST}${common_.CONSOLIDATE_INTERNAL_ROUTE}`;
const INTROSPECT_INTERNAL_URL = `${process.env.INTERNAL_API_HOST}${common_.INTROSPECT_INTERNAL_ROUTE}`;
const MODEL_PROMPT_TYPE_FIELD = 'type';
const MODEL_PROMPT_RECURSED_NOTE_FIELD = 'recursedNote';
const MODEL_PROMPT_RECURSED_QUERY_FIELD = 'recursedQuery';
const MODEL_PROMPT_SCORE_FIELD = 'score';
const MODEL_PROMPT_QUERY_FIELD = 'query';
const MODEL_PROMPT_REPLY_FIELD = 'reply';
const MODEL_PROMPT_SUMMARY_FIELD = 'summary';
const MODEL_PROMPT_INTROSPECTION_FIELD = 'introspection';
const MODEL_PROMPT_IMAGINATION_FIELD = 'imagination';
const MODEL_PROMPT = (info, search, actionHistory, actions, longTermContext, shortTermContext, query, recursedNote, recursedQuery) =>
    (!recursedQuery ? common.MODEL_PROMPT_EXTERNAL_COMPONENT_MSG : common.MODEL_PROMPT_INTERMEDIATE_COMPONENT_MSG)
    + `\ntime: ${common.MODEL_PROMPT_FORMATTED_TIME()}`
    + (!info ? '' : `\ninternal information: ${info}`)
    + (!search ? '' : `\ninternal search: ${search}`)
    + `\ninternal action history: ${JSON.stringify(actionHistory)}`
    + (!actions.length ? '' : `\ninternal actions: ${JSON.stringify(actions)}`)
    + `\nlong-term context: ${JSON.stringify(longTermContext)}`
    + `\nshort-term context: ${JSON.stringify(shortTermContext)}`
    + `\nquery: ${JSON.stringify(query)}`
    + (!recursedNote ? '' : `\ninternal recursed note: ${JSON.stringify(recursedNote)}`)
    // NB: better to not duplicate in case of recursing to same query
    + ((!recursedQuery || recursedQuery === query) ? '' : `\ninternal recursed query: ${JSON.stringify(recursedQuery)}`)
    + `\nreply`;
const MODEL_FUNCTION_NAME = 'act';
const MODEL_FUNCTION_TYPE_ARG_NAME = 'type';
const MODEL_FUNCTION_RECURSED_NOTE_ARG_NAME = 'recursedNote';
const MODEL_FUNCTION_RECURSED_QUERY_ARG_NAME = 'recursedQuery';
const MODEL_FUNCTION_RECURSED_QUERY_ARG_NAME_IS_POSSIBLE_TYPO = (k) => k.endsWith('Query');
const MODEL_FUNCTION_TYPE_THINK = 'think';
const MODEL_FUNCTION_TYPE_RESEARCH = 'research';
const MODEL_FUNCTION_TYPES = [MODEL_FUNCTION_TYPE_THINK, MODEL_FUNCTION_TYPE_RESEARCH];
const MODEL_FUNCTION = (query, recursedNote, recursedQuery) => ({
    name: MODEL_FUNCTION_NAME,
    description: '',
    parameters: {
        type: 'object',
        properties: {
            [MODEL_FUNCTION_RECURSED_NOTE_ARG_NAME]: {
                type: 'string',
                ...(!recursedNote ? {} : {description: `not in: ${JSON.stringify([recursedNote])}`}),
            },
            [MODEL_FUNCTION_RECURSED_QUERY_ARG_NAME]: {
                type: 'string',
                description: `not in: ${JSON.stringify((!recursedQuery || recursedQuery === query) ? [query] : [query, recursedQuery])}`,
            },
            [MODEL_FUNCTION_TYPE_ARG_NAME]: {type: 'string', enum: MODEL_FUNCTION_TYPES},
        },
        required: [MODEL_FUNCTION_RECURSED_NOTE_ARG_NAME, MODEL_FUNCTION_RECURSED_QUERY_ARG_NAME, MODEL_FUNCTION_TYPE_ARG_NAME],
    },
});
const QUERY_TOKEN_COUNT_LIMIT = strictParse.int(process.env.QUERY_QUERY_TOKEN_COUNT_LIMIT);
const RECURSED_NOTE_TOKEN_COUNT_LIMIT = strictParse.int(process.env.QUERY_RECURSED_NOTE_TOKEN_COUNT_LIMIT);
const RECURSED_QUERY_TOKEN_COUNT_LIMIT = strictParse.int(process.env.QUERY_RECURSED_QUERY_TOKEN_COUNT_LIMIT);
const INFO_TRUNCATION_TOKEN_COUNT = strictParse.int(process.env.QUERY_INFO_TRUNCATION_TOKEN_COUNT);
const SEARCH_TRUNCATION_TOKEN_COUNT = strictParse.int(process.env.QUERY_SEARCH_TRUNCATION_TOKEN_COUNT);
const ACTION_HISTORY_COUNT = strictParse.int(process.env.QUERY_ACTION_HISTORY_COUNT);
const MAX_ITERS_WITH_ACTIONS = strictParse.int(process.env.QUERY_MAX_ITERS_WITH_ACTIONS);
const CTX_SCORE_FIRST_ITEMS_COUNT = strictParse.int(process.env.QUERY_CTX_SCORE_FIRST_ITEMS_COUNT);
const CTX_SCORE_FIRST_ITEMS_MAX_VAL = strictParse.float(process.env.QUERY_CTX_SCORE_FIRST_ITEMS_MAX_VAL);
const CTX_SCORE_FIRST_ITEMS_LINEAR_DECAY = strictParse.float(process.env.QUERY_CTX_SCORE_FIRST_ITEMS_LINEAR_DECAY);
const CTX_SCORE_REST_ITEMS_MULT_FACTOR = strictParse.float(process.env.QUERY_CTX_SCORE_REST_ITEMS_MULT_FACTOR);
const CTX_SCORE_REST_ITEMS_IDX_OFFSET = strictParse.float(process.env.QUERY_CTX_SCORE_REST_ITEMS_IDX_OFFSET);
const CTX_SCORE_REST_ITEMS_IDX_DECAY_EXPONENT = strictParse.float(process.env.QUERY_CTX_SCORE_REST_ITEMS_IDX_DECAY_EXPONENT);
const CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MULT_FACTOR = strictParse.float(process.env.QUERY_CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MULT_FACTOR);
const CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MS_VAL = strictParse.float(process.env.QUERY_CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_HOUR_VAL) / (3600 * 1000);
const CTX_SCORE = (i, ms, getSim) => {
    if (i < CTX_SCORE_FIRST_ITEMS_COUNT) {
        return CTX_SCORE_FIRST_ITEMS_MAX_VAL - CTX_SCORE_FIRST_ITEMS_LINEAR_DECAY * i;
    }
    const idxTimePenalty = CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MULT_FACTOR * Math.log(CTX_SCORE_REST_ITEMS_IDX_TIME_PENALTY_MS_VAL * ms + 1);
    return CTX_SCORE_REST_ITEMS_MULT_FACTOR * (i + CTX_SCORE_REST_ITEMS_IDX_OFFSET + idxTimePenalty) ** -CTX_SCORE_REST_ITEMS_IDX_DECAY_EXPONENT * getSim();
};
const SHORT_TERM_CONTEXT_COUNT = strictParse.int(process.env.QUERY_SHORT_TERM_CONTEXT_COUNT);
const LONG_TERM_CONTEXT_COUNT = strictParse.int(process.env.QUERY_LONG_TERM_CONTEXT_COUNT);
const REPLY_TOKEN_COUNT_LIMIT = strictParse.int(process.env.QUERY_REPLY_TOKEN_COUNT_LIMIT);
const RECURSION_TIMEOUT = strictParse.int(process.env.QUERY_RECURSION_TIMEOUT_SECS) * 1000;
const MIN_SCHEDULED_IMAGINATION_DELAY = strictParse.int(process.env.QUERY_MIN_SCHEDULED_IMAGINATION_DELAY_MINUTES) * 60 * 1000;
const MAX_SCHEDULED_IMAGINATION_DELAY = strictParse.int(process.env.QUERY_MAX_SCHEDULED_IMAGINATION_DELAY_MINUTES) * 60 * 1000;

const query = wrapper.logCorrelationId('service.query.query', async (correlationId, userId, sessionId, query, recursedNote, recursedQuery, recursedQueryStack) => {
    log.log('query: parameters',
        {correlationId, userId, sessionId, query, recursedNote, recursedQuery, recursedQueryStack});
    const docId = common.DOC_ID.from(userId, sessionId);
    const actionLvl = recursedQueryStack.length;
    const start = new Date();
    const {queryTokenCount, recursedNoteTokenCount, recursedQueryTokenCount} =
        await getTokenCounts(correlationId, docId, query, recursedNote, recursedQuery);
    const [
        {info, infoTokenCount},
        {search, searchTokenCount},
        {actionHistory},
        {queryEmbedding, shortTermContext, longTermContext},
    ] = await Promise.all([
        // NB: do info and search only on recursion
        (async () => {
            if (!recursedQuery) {
                return {info: '', infoTokenCount: 0};
            }
            return await getInfo(correlationId, docId, recursedQuery);
        })(),
        (async () => {
            if (!recursedQuery) {
                return {search: '', searchTokenCount: 0};
            }
            return await getSearch(correlationId, docId, recursedQuery);
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
                getShortTermContext(correlationId, docId, start, doSim),
                getLongTermContext(correlationId, docId, doSim),
            ]);
            return {queryEmbedding, shortTermContext, longTermContext};
        })(),
    ]);
    let actions = [];
    let formattedActionsForPrompt = [];
    let prompts = [];
    let elapsedChats = [];
    let promptTokenCounts = [];
    let elapsedFunctionCalls = [];
    let functionCalls = [];
    let reply = '';
    let recursedNextQueryStack = null;
    let isFinalIter = false;
    let i = 0;
    while (true) {
        const localPrompt = MODEL_PROMPT(
            info, search, actionHistory, formattedActionsForPrompt, longTermContext, shortTermContext, query, recursedNote, recursedQuery);
        prompts.push(localPrompt)
        log.log(`query: iter ${i}: prompt`, {correlationId, docId, i, localPrompt});
        const startLocalChat = new Date();
        const {content: localReply, functionCalls: localFunctionCalls} = await common.chatWithRetry(
            correlationId, localPrompt, REPLY_TOKEN_COUNT_LIMIT, !isFinalIter ? MODEL_FUNCTION(query, recursedNote, recursedQuery) : null);
        const elapsedLocalChat = time.elapsedSecs(startLocalChat);
        elapsedChats.push(elapsedLocalChat);
        const localPromptTokenCount = await tokenizer.countTokens(correlationId, localPrompt);
        promptTokenCounts.push(localPromptTokenCount);
        if (!localFunctionCalls.length) {
            reply = localReply;
            break;
        }
        if (localReply) {
            log.log(`query: iter ${i}: function call: model also replied; discard`,
                {correlationId, docId, i, localReply});
        }
        log.log(`query: iter ${i}: function call: function calls`, {correlationId, docId, i, localFunctionCalls});
        const startLocalFunctionCalls = new Date();
        recursedNextQueryStack ||= !recursedQuery ? [query] : [...recursedQueryStack, recursedQuery];
        const localActionTasks = [];
        for (const {name, args} of localFunctionCalls) {
            if (name !== MODEL_FUNCTION_NAME) {
                log.log(`query: iter ${i}: function call: invalid function: ${name}; continue nevertheless`,
                    {correlationId, docId, i, name, args});
            }
            let {
                [MODEL_FUNCTION_TYPE_ARG_NAME]: type,
                [MODEL_FUNCTION_RECURSED_NOTE_ARG_NAME]: rawRecursedNextNote,
                [MODEL_FUNCTION_RECURSED_QUERY_ARG_NAME]: recursedNextQuery,
            } = args;
            if (type === undefined && MODEL_FUNCTION_TYPES.includes(name)) {
                type = name;
                log.log(`query: iter ${i}: function call: use fallback type`,
                    {correlationId, docId, i, name, args, type});
            }
            if (recursedNextQuery === undefined) {
                for (const [k, v] of Object.entries(args)) {
                    if (MODEL_FUNCTION_RECURSED_QUERY_ARG_NAME_IS_POSSIBLE_TYPO(k)) {
                        recursedNextQuery = v;
                        log.log(`query: iter ${i}: function call: use fallback recursed query`,
                            {correlationId, docId, i, name, args, recursedNextQuery});
                        break;
                    }
                }
            }
            const recursedNextNote = rawRecursedNextNote || null;
            if (!MODEL_FUNCTION_TYPES.includes(type)
                || (recursedNote && recursedNextNote === recursedNote)
                || (!recursedNextQuery || recursedNextQuery === query || recursedNextQuery === recursedQuery)) {
                log.log(`query: iter ${i}: function call: invalid args`, {correlationId, docId, i, args});
                continue;
            }
            if (functionCalls.some(({v: calls}) => calls.some(({args}) =>
                args[MODEL_FUNCTION_TYPE_ARG_NAME] === type && args[MODEL_FUNCTION_RECURSED_QUERY_ARG_NAME] === recursedNextQuery))) {
                log.log(`query: iter ${i}: function call: duplicate`, {correlationId, docId, i, args});
                continue;
            }
            localActionTasks.push((async () => {
                let reply = null;
                let data = null;
                switch (type) {
                    case MODEL_FUNCTION_TYPE_THINK:
                        const thinkRes =
                            await thinkAction(correlationId, docId, query, recursedNextNote, recursedNextQuery, recursedNextQueryStack);
                        reply = thinkRes.reply || null;
                        data = thinkRes.data || null;
                        break;
                    case MODEL_FUNCTION_TYPE_RESEARCH:
                        const researchRes =
                            await researchAction(correlationId, docId, query, recursedNextNote, recursedNextQuery, recursedNextQueryStack);
                        reply = researchRes.reply || null;
                        data = researchRes.data || null;
                        break;
                }
                return !reply ? {
                    full: null,
                } : {
                    full: {
                        type,
                        recursedNextNote,
                        recursedNextQuery,
                        data,
                    },
                    formatted: {
                        [MODEL_PROMPT_TYPE_FIELD]: type,
                        [MODEL_PROMPT_RECURSED_NOTE_FIELD]: recursedNextNote || '',
                        [MODEL_PROMPT_RECURSED_QUERY_FIELD]: recursedNextQuery,
                        [MODEL_PROMPT_REPLY_FIELD]: reply,
                    },
                };
            })());
        }
        localActionTasks.forEach((task) => task.then(async (res) => {
            const {full, formatted} = res;
            if (!full) {
                return;
            }
            const {
                [MODEL_PROMPT_TYPE_FIELD]: type,
                [MODEL_PROMPT_RECURSED_NOTE_FIELD]: recursedNote,
                [MODEL_PROMPT_RECURSED_QUERY_FIELD]: recursedQuery,
                [MODEL_PROMPT_REPLY_FIELD]: reply,
            } = formatted;
            await memory.addAction(correlationId, docId, actionLvl, {
                [common.TYPE_FIELD]: type,
                [common.RECURSED_NOTE_FIELD]: recursedNote,
                [common.RECURSED_QUERY_FIELD]: recursedQuery,
                [common.REPLY_FIELD]: reply,
            }, {correlationId}).catch((e) =>
                log.log(`query: iter ${i}: function call: add action failed; continue since it is not critical`, {
                    correlationId, docId, i, actionLvl, error: e.message || '', stack: e.stack || '',
                }));
        }));
        const rawLocalActions = (await Promise.all(localActionTasks))
            .filter(({full}) => full);
        const localActions = rawLocalActions.map(({full}) => full);
        // NB: exclude some fields to not overly influence further actions
        const localFormattedActionsForPrompt = rawLocalActions.map(({formatted}) => formatted)
            .map(({[MODEL_PROMPT_TYPE_FIELD]: type, [MODEL_PROMPT_REPLY_FIELD]: reply}) =>
                ({[MODEL_PROMPT_TYPE_FIELD]: type, [MODEL_PROMPT_REPLY_FIELD]: reply}));
        actions.push({v: localActions});
        formattedActionsForPrompt.push(...localFormattedActionsForPrompt);
        const elapsedLocalFunctionCalls = time.elapsedSecs(startLocalFunctionCalls);
        elapsedFunctionCalls.push(elapsedLocalFunctionCalls);
        functionCalls.push({v: localFunctionCalls});
        if (!localActions.length) {
            log.log(`query: iter ${i}: function call: no result`,
                {correlationId, docId, i});
            isFinalIter = true;
        }
        if (i >= MAX_ITERS_WITH_ACTIONS - 1) {
            log.log(`query: iter ${i}: function call: at max iters`,
                {correlationId, docId, i});
            isFinalIter = true;
        }
        i++;
    }
    const replyTokenCount = await tokenizer.countTokens(correlationId, reply);
    const elapsed = time.elapsedSecs(start);
    const extra = {
        correlationId,
        info,
        search,
        actionHistory,
        shortTermContext,
        longTermContext,
        functionCalls,
        actions,
        tokenCounts: {
            query: queryTokenCount,
            recursedNote: recursedNoteTokenCount,
            recursedQuery: recursedQueryTokenCount,
            info: infoTokenCount,
            search: searchTokenCount,
            prompts: promptTokenCounts,
            reply: replyTokenCount,
        },
        timeStats: {
            elapsed,
            elapsedChats,
            elapsedFunctionCalls,
        },
    };
    if (recursedQuery) {
        return {
            reply,
            ...extra,
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
            };
            return await memory.add(correlationId, docId, {
                [common.QUERY_FIELD]: query,
                [common.QUERY_EMBEDDING_FIELD]: queryEmbedding,
                [common.REPLY_FIELD]: reply,
                [common.REPLY_EMBEDDING_FIELD]: replyEmbedding,
            }, dbExtra, false);
        })(),
        setScheduledImagination(correlationId, docId),
    ]);
    triggerBackgroundTasks(correlationId, docId, index);
    return {
        index,
        timestamp,
        reply,
        ...extra,
        scheduledImagination,
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
            throw new Error(`query: recursed note or query token count exceeds limit:` +
                ` ${recursedNoteTokenCount} > ${RECURSED_NOTE_TOKEN_COUNT_LIMIT} or ${recursedQueryTokenCount} > ${RECURSED_QUERY_TOKEN_COUNT_LIMIT}`);
        }
    }
    return {queryTokenCount, recursedNoteTokenCount, recursedQueryTokenCount};
};

const getInfo = async (correlationId, docId, recursedQuery) => {
    let info = '';
    let infoTokenCount = 0;
    try {
        const {pods: rawInfo} = await common.wolframAlphaQueryWithRetry(correlationId, recursedQuery);
        if (rawInfo.length) {
            const {truncated, tokenCount} = await tokenizer.truncate(
                correlationId, JSON.stringify(rawInfo), INFO_TRUNCATION_TOKEN_COUNT);
            info = truncated;
            infoTokenCount = Math.min(tokenCount, INFO_TRUNCATION_TOKEN_COUNT);
        }
    } catch (e) {
        log.log('query: wolfram alpha query failed; continue since it is not critical',
            {correlationId, docId, recursedQuery, error: e.message || '', stack: e.stack || ''});
    }
    log.log('query: info', {correlationId, docId, info, infoTokenCount});
    return {info, infoTokenCount};
};

const getSearch = async (correlationId, docId, recursedQuery) => {
    let search = '';
    let searchTokenCount = 0;
    try {
        const {data: rawSearch} = await common.serpSearchWithRetry(correlationId, recursedQuery);
        if (rawSearch) {
            const {truncated, tokenCount} = await tokenizer.truncate(
                correlationId, JSON.stringify(rawSearch), SEARCH_TRUNCATION_TOKEN_COUNT);
            search = truncated;
            searchTokenCount = Math.min(tokenCount, SEARCH_TRUNCATION_TOKEN_COUNT);
        }
    } catch (e) {
        log.log('query: serp search failed; continue since it is not critical',
            {correlationId, docId, recursedQuery, error: e.message || '', stack: e.stack || ''});
    }
    log.log('query: search', {correlationId, docId, search, searchTokenCount});
    return {search, searchTokenCount};
};

const getActionHistory = async (correlationId, docId, actionLvl) => {
    const rawActionHistory = await memory.getActions(correlationId, docId, actionLvl, ACTION_HISTORY_COUNT);
    const actionHistory = rawActionHistory.map(
        ({
             [common.TYPE_FIELD]: type,
             [common.RECURSED_NOTE_FIELD]: recursedNote,
             [common.RECURSED_QUERY_FIELD]: recursedQuery,
             [common.REPLY_FIELD]: reply,
         }) => ({
            [MODEL_PROMPT_TYPE_FIELD]: type,
            [MODEL_PROMPT_RECURSED_NOTE_FIELD]: recursedNote,
            [MODEL_PROMPT_RECURSED_QUERY_FIELD]: recursedQuery,
            [MODEL_PROMPT_REPLY_FIELD]: reply,
        }));
    log.log('query: action history', {correlationId, docId, actionHistory});
    return {actionHistory};
};

const getShortTermContext = async (correlationId, docId, start, doSim) => {
    const rawShortTermContext = await memory.shortTermSearch(correlationId, docId, (elt, i, timestamp) => {
        const ms = start - timestamp;
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
        const score = parseFloat(rawScore.toFixed(3));
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

const thinkAction = async (correlationId, docId, query, recursedNextNote, recursedNextQuery, recursedNextQueryStack) => {
    // NB: prevent infinite recursion
    if (recursedNextQueryStack.includes(recursedNextQuery)) {
        log.log('query: action: think: recursed query is duplicate',
            {correlationId, docId, recursedNextQuery, recursedNextQueryStack});
        return {reply: null};
    }
    const {userId, sessionId} = common.DOC_ID.parse(docId);
    const recursedCorrelationId = uuid.v4();
    log.log('query: action: think: correlation id',
        {correlationId, docId, recursedNextQuery, recursedCorrelationId});
    try {
        const resp = await fetch_.withTimeout(QUERY_INTERNAL_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                [common_.CORRELATION_ID_HEADER]: recursedCorrelationId,
                [common_.INTERNAL_API_ACCESS_KEY_HEADER]: common_.SECRETS.INTERNAL_API_ACCESS_KEY,
            },
            body: JSON.stringify({
                userId, sessionId, query,
                recursedNote: recursedNextNote, recursedQuery: recursedNextQuery,
                recursedQueryStack: recursedNextQueryStack,
            }),
        }, RECURSION_TIMEOUT);
        if (!resp.ok) {
            throw new Error(`query: action: think: api error, status: ${resp.status}`);
        }
        const data = await resp.json();
        log.log('query: action: think: result',
            {correlationId, docId, recursedNextQuery, recursedCorrelationId});
        const {reply} = data;
        return {reply, data};
    } catch (e) {
        log.log('query: action: think: failed', {
            correlationId, docId, recursedNextQuery, recursedCorrelationId,
            error: e.message || '', stack: e.stack || '',
        });
        return {reply: null};
    }
};

const researchAction = async (correlationId, docId, query, recursedNextNote, recursedNextQuery, recursedNextQueryStack) => {
    const {userId, sessionId} = common.DOC_ID.parse(docId);
    const recursedCorrelationId = uuid.v4();
    log.log('query: action: research: correlation id',
        {correlationId, docId, recursedNextQuery, recursedCorrelationId});
    try {
        const resp = await fetch_.withTimeout(RESEARCH_INTERNAL_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                [common_.CORRELATION_ID_HEADER]: recursedCorrelationId,
                [common_.INTERNAL_API_ACCESS_KEY_HEADER]: common_.SECRETS.INTERNAL_API_ACCESS_KEY,
            },
            body: JSON.stringify({
                userId, sessionId, query,
                recursedNote: recursedNextNote, recursedQuery: recursedNextQuery,
                recursedQueryStack: recursedNextQueryStack,
            }),
        }, RECURSION_TIMEOUT);
        if (!resp.ok) {
            throw new Error(`query: action: research: api error, status: ${resp.status}`);
        }
        const data = await resp.json();
        log.log('query: action: research: result',
            {correlationId, docId, recursedNextQuery, recursedCorrelationId});
        const {reply} = data;
        return {reply, data};
    } catch (e) {
        log.log('query: action: research: failed', {
            correlationId, docId, recursedNextQuery, recursedCorrelationId,
            error: e.message || '', stack: e.stack || '',
        });
        return {reply: null};
    }
};

const setScheduledImagination = async (correlationId, docId) => {
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
        log.log('query: schedule imagination failed; continue since it is of low priority', {
            correlationId, docId, error: e.message || '', stack: e.stack || '',
        });
        return null;
    });
};

const triggerBackgroundTasks = (correlationId, docId, index) => {
    const {userId, sessionId} = common.DOC_ID.parse(docId);
    fetch_.withTimeout(CONSOLIDATE_INTERNAL_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            [common_.CORRELATION_ID_HEADER]: correlationId,
            [common_.INTERNAL_API_ACCESS_KEY_HEADER]: common_.SECRETS.INTERNAL_API_ACCESS_KEY,
        },
        body: JSON.stringify({userId, sessionId}),
    }, 60 * 1000).catch((e) =>
        log.log(`query: fetch ${common_.CONSOLIDATE_INTERNAL_ROUTE} failed, likely timed out`, {
            correlationId, docId, error: e.message || '', stack: e.stack || '',
        }));
    fetch_.withTimeout(INTROSPECT_INTERNAL_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            [common_.CORRELATION_ID_HEADER]: correlationId,
            [common_.INTERNAL_API_ACCESS_KEY_HEADER]: common_.SECRETS.INTERNAL_API_ACCESS_KEY,
        },
        body: JSON.stringify({userId, sessionId, index}),
    }, 60 * 1000).catch((e) =>
        log.log(`query: fetch ${common_.INTROSPECT_INTERNAL_ROUTE} failed, likely timed out`, {
            correlationId, docId, error: e.message || '', stack: e.stack || '',
        }));
};

export default {
    query,
};
