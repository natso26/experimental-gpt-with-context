import firestore from '@google-cloud/firestore';
import strictParse from '../util/strictParse.js';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const TOP_LEVEL_COLLECTION = 'memory';
const SCHEDULED_IMAGINATION_FIELD = 'scheduledImagination';
const ELT_COLLECTION = 'elts';
const CONSOLIDATION_COLLECTION = (lvl) => `${lvl}-consolidations`;
const IMAGINATION_COLLECTION = 'imaginations';
const INDEX_FIELD = 'index';
const TIMESTAMP_FIELD = 'timestamp';
const IS_INTERNAL_FIELD = 'isInternal';
const ELT_FIELD = 'elt';
const CONSOLIDATION_FIELD = 'consolidation';
const EXTRA_FIELD = 'extra';
const SHORT_TERM_SEARCH_LOOKBACK_LIMIT = strictParse.int(process.env.MEMORY_SHORT_TERM_SEARCH_LOOKBACK_LIMIT);
const LONG_TERM_SEARCH_SUMMARY_LOOKBACK_LIMIT = strictParse.int(process.env.MEMORY_LONG_TERM_SEARCH_SUMMARY_LOOKBACK_LIMIT);
const LONG_TERM_SEARCH_IMAGINATION_LOOKBACK_LIMIT = strictParse.int(process.env.MEMORY_LONG_TERM_SEARCH_IMAGINATION_LOOKBACK_LIMIT);
const MAX_CONSOLIDATION_LVL = strictParse.int(process.env.MEMORY_MAX_CONSOLIDATION_LVL);
const BASE_CONSOLIDATION_SIZE = strictParse.int(process.env.MEMORY_BASE_CONSOLIDATION_SIZE);
const BASE_CONSOLIDATION_FREQ = strictParse.int(process.env.MEMORY_BASE_CONSOLIDATION_FREQ);
const HIGHER_CONSOLIDATION_SIZE = strictParse.int(process.env.MEMORY_HIGHER_CONSOLIDATION_SIZE);
const HIGHER_CONSOLIDATION_FREQ = strictParse.int(process.env.MEMORY_HIGHER_CONSOLIDATION_FREQ);

const db = new firestore.Firestore();
const coll = db.collection(TOP_LEVEL_COLLECTION);

const add = wrapper.logCorrelationId('repository.memory.add', async (correlationId, chatId, elt, extra, isInternal) => {
    const eltsColl = coll.doc(chatId).collection(ELT_COLLECTION);
    const timestamp = new Date();
    return await db.runTransaction(async (txn) => {
        const snapshot = await txn.get(
            eltsColl.select(INDEX_FIELD).orderBy(INDEX_FIELD, 'desc').limit(1));
        const index = snapshot.empty ? 0 : snapshot.docs[0].data()[INDEX_FIELD] + 1;
        await txn.set(eltsColl.doc(), {
            [INDEX_FIELD]: index,
            [TIMESTAMP_FIELD]: timestamp,
            [IS_INTERNAL_FIELD]: isInternal,
            [ELT_FIELD]: elt,
            [EXTRA_FIELD]: extra,
        });
        return {index, timestamp};
    });
});

const addImagination = wrapper.logCorrelationId('repository.memory.addImagination', async (correlationId, chatId, consolidation, extra) => {
    const imaginationsColl = coll.doc(chatId).collection(IMAGINATION_COLLECTION);
    const timestamp = new Date();
    return await db.runTransaction(async (txn) => {
        const snapshot = await txn.get(
            imaginationsColl.select(INDEX_FIELD).orderBy(INDEX_FIELD, 'desc').limit(1));
        const index = snapshot.empty ? 0 : snapshot.docs[0].data()[INDEX_FIELD] + 1;
        await txn.set(imaginationsColl.doc(), {
            [INDEX_FIELD]: index,
            [TIMESTAMP_FIELD]: timestamp,
            [CONSOLIDATION_FIELD]: consolidation,
            [EXTRA_FIELD]: extra,
        });
        return {index, timestamp};
    });
});

const getLatest = wrapper.logCorrelationId('repository.memory.getLatest', async (correlationId, chatId, numResults) => {
    const snapshot = await coll.doc(chatId).collection(ELT_COLLECTION)
        .select(INDEX_FIELD, ELT_FIELD).orderBy(INDEX_FIELD, 'desc').limit(numResults).get();
    const data = snapshot.docs.map(doc => doc.data());
    const elts = data.map(({[ELT_FIELD]: elt}) => elt).reverse();
    const latestIndex = data.empty ? -1 : data[0][INDEX_FIELD];
    return {elts, latestIndex};
});

const getHistory = wrapper.logCorrelationId('repository.memory.getHistory', async (correlationId, chatId, offset, limit) => {
    const snapshot = await coll.doc(chatId).collection(ELT_COLLECTION)
        .select(INDEX_FIELD, IS_INTERNAL_FIELD, ELT_FIELD)
        .where(IS_INTERNAL_FIELD, '!=', true).orderBy(IS_INTERNAL_FIELD)
        .orderBy(INDEX_FIELD, 'desc').offset(offset).limit(limit).get();
    const data = snapshot.docs.map(doc => doc.data());
    return data.map(({[ELT_FIELD]: elt}) => elt).reverse();
});

const shortTermSearch = wrapper.logCorrelationId('repository.memory.shortTermSearch', async (correlationId, chatId, maximizingObjective, numResults) => {
    const snapshot = await coll.doc(chatId).collection(ELT_COLLECTION)
        .select(INDEX_FIELD, TIMESTAMP_FIELD, ELT_FIELD).orderBy(INDEX_FIELD, 'desc').limit(SHORT_TERM_SEARCH_LOOKBACK_LIMIT).get();
    const data = snapshot.docs.map(doc => doc.data());
    return data.map(({[TIMESTAMP_FIELD]: timestamp, [ELT_FIELD]: elt}, i) =>
        [elt, maximizingObjective(elt, i, timestamp.toDate())])
        .sort((a, b) => b[1] - a[1])
        .slice(0, numResults);
});

const longTermSearch = wrapper.logCorrelationId('repository.memory.longTermSearch', async (correlationId, chatId, maximizingObjective, numResults) => {
    const data = [];
    for (let lvl = 0; lvl <= MAX_CONSOLIDATION_LVL + 1; lvl++) {
        const lookbackLimit = lvl ? LONG_TERM_SEARCH_IMAGINATION_LOOKBACK_LIMIT : LONG_TERM_SEARCH_SUMMARY_LOOKBACK_LIMIT;
        const snapshot = await coll.doc(chatId)
            .collection(lvl <= MAX_CONSOLIDATION_LVL ? CONSOLIDATION_COLLECTION(lvl) : IMAGINATION_COLLECTION)
            .select(INDEX_FIELD, CONSOLIDATION_FIELD).orderBy(INDEX_FIELD, 'desc').limit(lookbackLimit).get();
        if (snapshot.empty) {
            continue;
        }
        const rawLvlData = snapshot.docs.map(doc => doc.data());
        const lvlData = rawLvlData.filter(({[INDEX_FIELD]: index}) =>
            index > rawLvlData[rawLvlData.length - 1][INDEX_FIELD] - lookbackLimit);
        data.push(...lvlData);
    }
    const getConsolidations = () => data.map(({[CONSOLIDATION_FIELD]: consolidation}) => consolidation);
    return data.map(({[CONSOLIDATION_FIELD]: consolidation}) =>
        [consolidation, maximizingObjective(getConsolidations, consolidation)])
        .sort((a, b) => b[1] - a[1])
        .slice(0, numResults);
});

const consolidate = wrapper.logCorrelationId('repository.memory.consolidate', async (correlationId, chatId, consolidationFn) => {
    const ret = [];
    for (let lvl = 0; lvl <= MAX_CONSOLIDATION_LVL; lvl++) {
        const prevLvlColl = coll.doc(chatId).collection(
            lvl ? CONSOLIDATION_COLLECTION(lvl - 1) : ELT_COLLECTION);
        const lvlColl = coll.doc(chatId).collection(CONSOLIDATION_COLLECTION(lvl));
        const txnRes = await db.runTransaction(async (txn) => {
            const s = await txn.get(
                prevLvlColl.select(INDEX_FIELD).orderBy(INDEX_FIELD, 'desc').limit(1));
            const latestPrevLvlIndex = s.empty ? -1 : s.docs[0].data()[INDEX_FIELD];
            const s2 = await txn.get(
                lvlColl.select(INDEX_FIELD).orderBy(INDEX_FIELD, 'desc').limit(1));
            const latestLvlIndex = s2.empty ? -1 : s2.docs[0].data()[INDEX_FIELD];
            const size = lvl ? HIGHER_CONSOLIDATION_SIZE : BASE_CONSOLIDATION_SIZE;
            const freq = lvl ? HIGHER_CONSOLIDATION_FREQ : BASE_CONSOLIDATION_FREQ;
            const targetLvlIndex = Math.floor((latestPrevLvlIndex - size + 1) / freq);
            if (targetLvlIndex < 0) {
                return 'final-level';
            }
            if (targetLvlIndex <= latestLvlIndex) {
                return;
            }
            const prevLvlSnapshot = await txn.get(
                prevLvlColl.select(INDEX_FIELD, lvl ? CONSOLIDATION_FIELD : ELT_FIELD).orderBy(INDEX_FIELD, 'desc')
                    .offset((latestPrevLvlIndex - size + 1) % freq).limit(freq * (targetLvlIndex - latestLvlIndex - 1) + size));
            const prevLvlData = prevLvlSnapshot.docs
                .map(doc => doc.data()).reverse();
            for (let i = latestLvlIndex + 1; i <= targetLvlIndex; i++) {
                const raw = prevLvlData.slice(freq * (i - latestLvlIndex - 1), freq * (i - latestLvlIndex - 1) + size);
                const {consolidation, extra} = await consolidationFn(lvl,
                    raw.map(({[lvl ? CONSOLIDATION_FIELD : ELT_FIELD]: v}) => v));
                const timestamp = new Date();
                await txn.set(lvlColl.doc(), {
                    [INDEX_FIELD]: i,
                    [TIMESTAMP_FIELD]: timestamp,
                    [CONSOLIDATION_FIELD]: consolidation,
                    [EXTRA_FIELD]: extra,
                });
                ret.push({lvl, index: i, timestamp, consolidation, extra});
            }
        });
        if (txnRes === 'final-level') {
            break;
        }
    }
    return ret;
});

const scheduleImagination = wrapper.logCorrelationId('repository.memory.scheduleImagination', async (correlationId, chatId, getNext) => {
    return await db.runTransaction(async (txn) => {
        const doc = coll.doc(chatId);
        const s = await txn.get(doc);
        const curr = s.data()?.[SCHEDULED_IMAGINATION_FIELD]?.toDate() || null;
        const scheduledImagination = getNext(curr);
        if (scheduledImagination !== curr) {
            await txn.set(doc,
                {[SCHEDULED_IMAGINATION_FIELD]: scheduledImagination || firestore.FieldValue.delete()},
                {merge: true});
        }
        return scheduledImagination;
    });
});

const imagine = wrapper.logCorrelationId('repository.memory.imagine', async (correlationId, refTime, imaginationFn) => {
    const s = await coll
        .select(SCHEDULED_IMAGINATION_FIELD).where(SCHEDULED_IMAGINATION_FIELD, '<=', firestore.Timestamp.fromDate(refTime))
        .orderBy(SCHEDULED_IMAGINATION_FIELD).get();
    const chatIds = s.docs.map(doc => doc.id);
    log.log(`imagine for chat IDs: ${chatIds}`, {correlationId, chatIds});
    const ret = {};
    for (const chatId of chatIds) {
        const o = await db.runTransaction(async (txn) => {
            const doc = coll.doc(chatId);
            const scheduledImagination =
                (await txn.get(doc)).data()?.[SCHEDULED_IMAGINATION_FIELD]?.toDate();
            if (!(scheduledImagination && scheduledImagination <= refTime)) {
                log.log(`chat ID ${chatId} scheduled imagination has already changed and so will be skipped`,
                    {correlationId, chatId, scheduledImagination, refTime});
                return;
            }
            const out = await imaginationFn(chatId);
            await txn.set(doc, {[SCHEDULED_IMAGINATION_FIELD]: firestore.FieldValue.delete()}, {merge: true});
            return out;
        });
        ret[chatId] = o;
    }
    return ret;
});

export default {
    add,
    addImagination,
    getLatest,
    getHistory,
    shortTermSearch,
    longTermSearch,
    consolidate,
    scheduleImagination,
    imagine,
};
