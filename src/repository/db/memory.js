import firestore from '@google-cloud/firestore';
import strictParse from '../../util/strictParse.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';

const TOP_LEVEL_COLLECTION = 'memory';
const SCHEDULED_IMAGINATION_FIELD = 'scheduledImagination';
const ELT_COLLECTION = 'elts';
const CONSOLIDATION_COLLECTION = (lvl) => `${lvl}-consolidations`;
const IMAGINATION_COLLECTION = 'imaginations';
const ACTION_COLLECTION = 'actions';
const INDEX_FIELD = 'index';
const TIMESTAMP_FIELD = 'timestamp';
const IS_INTERNAL_FIELD = 'isInternal';
const LVL_FIELD = 'lvl';
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

const add = wrapper.logCorrelationId('repository.db.memory.add', async (correlationId, docId, elt, extra, isInternal) => {
    const eltsColl = coll.doc(docId).collection(ELT_COLLECTION);
    return await doAdd(eltsColl, {
        [IS_INTERNAL_FIELD]: isInternal,
        [ELT_FIELD]: elt,
        [EXTRA_FIELD]: extra,
    });
});

const addImagination = wrapper.logCorrelationId('repository.db.memory.addImagination', async (correlationId, docId, consolidation, extra) => {
    const imaginationsColl = coll.doc(docId).collection(IMAGINATION_COLLECTION);
    return await doAdd(imaginationsColl, {
        [CONSOLIDATION_FIELD]: consolidation,
        [EXTRA_FIELD]: extra,
    });
});

const addAction = wrapper.logCorrelationId('repository.db.memory.addAction', async (correlationId, docId, lvl, elt, extra) => {
    const actionsColl = coll.doc(docId).collection(ACTION_COLLECTION);
    return await doAdd(actionsColl, {
        [LVL_FIELD]: lvl,
        [ELT_FIELD]: elt,
        [EXTRA_FIELD]: extra,
    });
});

const doAdd = async (coll, partialDoc) => {
    const timestamp = new Date();
    return await db.runTransaction(async (txn) => {
        const snapshot = await txn.get(
            coll.select(INDEX_FIELD).orderBy(INDEX_FIELD, 'desc').limit(1));
        const index = snapshot.empty ? 0 : snapshot.docs[0].data()[INDEX_FIELD] + 1;
        await txn.set(coll.doc(), {
            [INDEX_FIELD]: index,
            [TIMESTAMP_FIELD]: timestamp,
            ...partialDoc,
        });
        return {index, timestamp};
    });
};

const getLatest = wrapper.logCorrelationId('repository.db.memory.getLatest', async (correlationId, docId, numResults) => {
    const snapshot = await coll.doc(docId).collection(ELT_COLLECTION)
        .select(INDEX_FIELD, ELT_FIELD).orderBy(INDEX_FIELD, 'desc').limit(numResults).get();
    const data = snapshot.docs.map(doc => doc.data());
    const elts = data.map(({[ELT_FIELD]: elt}) => elt).reverse();
    const latestIndex = data.empty ? -1 : data[0][INDEX_FIELD];
    return {elts, latestIndex};
});

const getHistory = wrapper.logCorrelationId('repository.db.memory.getHistory', async (correlationId, docId, offset, limit) => {
    const snapshot = await coll.doc(docId).collection(ELT_COLLECTION)
        .select(INDEX_FIELD, IS_INTERNAL_FIELD, ELT_FIELD)
        .where(IS_INTERNAL_FIELD, '!=', true).orderBy(IS_INTERNAL_FIELD)
        .orderBy(INDEX_FIELD, 'desc').offset(offset).limit(limit).get();
    const data = snapshot.docs.map(doc => doc.data());
    return data.map(({[ELT_FIELD]: elt}) => elt).reverse();
});

const getActions = wrapper.logCorrelationId('repository.db.memory.getActions', async (correlationId, docId, lvl, numResults) => {
    const snapshot = await coll.doc(docId).collection(ACTION_COLLECTION)
        .select(INDEX_FIELD, LVL_FIELD, ELT_FIELD)
        .where(LVL_FIELD, '==', lvl).orderBy(LVL_FIELD)
        .orderBy(INDEX_FIELD, 'desc').limit(numResults).get();
    const data = snapshot.docs.map(doc => doc.data());
    return data.map(({[ELT_FIELD]: elt}) => elt).reverse();
});

const getPinpoint = wrapper.logCorrelationId('repository.db.memory.getPinpoint', async (correlationId, docId, condition) => {
    const {type, offset, index} = condition;
    let snapshot;
    switch (type) {
        case 'elt':
            snapshot = await coll.doc(docId).collection(ELT_COLLECTION)
                .where(IS_INTERNAL_FIELD, '!=', true).orderBy(IS_INTERNAL_FIELD)
                .orderBy(INDEX_FIELD, 'desc').offset(offset).limit(1).get();
            break;
        case 'action':
            snapshot = await coll.doc(docId).collection(ACTION_COLLECTION)
                .where(INDEX_FIELD, '==', index).orderBy(INDEX_FIELD).limit(1).get();
            break;
    }
    if (!snapshot || snapshot.empty) {
        return null;
    }
    return snapshot.docs[0].data();
});

const shortTermSearch = wrapper.logCorrelationId('repository.db.memory.shortTermSearch', async (correlationId, docId, maximizingObjective, numResults) => {
    const snapshot = await coll.doc(docId).collection(ELT_COLLECTION)
        .select(INDEX_FIELD, TIMESTAMP_FIELD, ELT_FIELD).orderBy(INDEX_FIELD, 'desc').limit(SHORT_TERM_SEARCH_LOOKBACK_LIMIT).get();
    const data = snapshot.docs.map(doc => doc.data());
    return data.map(({[TIMESTAMP_FIELD]: timestamp, [ELT_FIELD]: elt}, i) =>
        [elt, maximizingObjective(elt, i, timestamp.toDate())])
        .sort((a, b) => b[1] - a[1])
        .slice(0, numResults);
});

const longTermSearch = wrapper.logCorrelationId('repository.db.memory.longTermSearch', async (correlationId, docId, maximizingObjective, numResults) => {
    const data = [];
    for (let lvl = 0; lvl <= MAX_CONSOLIDATION_LVL + 1; lvl++) {
        const lookbackLimit = lvl ? LONG_TERM_SEARCH_IMAGINATION_LOOKBACK_LIMIT : LONG_TERM_SEARCH_SUMMARY_LOOKBACK_LIMIT;
        const snapshot = await coll.doc(docId)
            .collection(lvl <= MAX_CONSOLIDATION_LVL ? CONSOLIDATION_COLLECTION(lvl) : IMAGINATION_COLLECTION)
            .select(INDEX_FIELD, CONSOLIDATION_FIELD).orderBy(INDEX_FIELD, 'desc').limit(lookbackLimit).get();
        if (snapshot.empty) {
            continue;
        }
        const rawLvlData = snapshot.docs.map(doc => doc.data());
        const lvlData = rawLvlData.filter(({[INDEX_FIELD]: index}) =>
            index > rawLvlData.at(-1)[INDEX_FIELD] - lookbackLimit);
        data.push(...lvlData);
    }
    const getConsolidations = () => data.map(({[CONSOLIDATION_FIELD]: consolidation}) => consolidation);
    return data.map(({[CONSOLIDATION_FIELD]: consolidation}) =>
        [consolidation, maximizingObjective(getConsolidations, consolidation)])
        .sort((a, b) => b[1] - a[1])
        .slice(0, numResults);
});

const consolidate = wrapper.logCorrelationId('repository.db.memory.consolidate', async (correlationId, docId, consolidationFn) => {
    const ret = [];
    for (let lvl = 0; lvl <= MAX_CONSOLIDATION_LVL; lvl++) {
        const prevLvlColl = coll.doc(docId).collection(
            lvl ? CONSOLIDATION_COLLECTION(lvl - 1) : ELT_COLLECTION);
        const lvlColl = coll.doc(docId).collection(CONSOLIDATION_COLLECTION(lvl));
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
                const {consolidation, extra, passOnRet} = await consolidationFn(lvl,
                    raw.map(({[lvl ? CONSOLIDATION_FIELD : ELT_FIELD]: v}) => v));
                const timestamp = new Date();
                await txn.set(lvlColl.doc(), {
                    [INDEX_FIELD]: i,
                    [TIMESTAMP_FIELD]: timestamp,
                    [CONSOLIDATION_FIELD]: consolidation,
                    [EXTRA_FIELD]: extra,
                });
                ret.push({lvl, index: i, timestamp, passOnRet});
            }
        });
        if (txnRes === 'final-level') {
            break;
        }
    }
    return ret;
});

const scheduleImagination = wrapper.logCorrelationId('repository.db.memory.scheduleImagination', async (correlationId, docId, getNext) => {
    return await db.runTransaction(async (txn) => {
        const doc = coll.doc(docId);
        const s = await txn.get(doc);
        const curr = s.data()?.[SCHEDULED_IMAGINATION_FIELD]?.toDate() || null;
        const scheduledImagination = getNext(curr);
        if (scheduledImagination !== curr) {
            await txn.set(doc,
                {[SCHEDULED_IMAGINATION_FIELD]: scheduledImagination || firestore.FieldValue.delete()},
                {merge: true});
        }
        return {scheduledImagination};
    });
});

const imagine = wrapper.logCorrelationId('repository.db.memory.imagine', async (correlationId, refTime, imaginationFn) => {
    const s = await coll
        .select(SCHEDULED_IMAGINATION_FIELD).where(SCHEDULED_IMAGINATION_FIELD, '<=', firestore.Timestamp.fromDate(refTime))
        .orderBy(SCHEDULED_IMAGINATION_FIELD).get();
    const docIds = s.docs.map(doc => doc.id);
    log.log(`imagine for doc IDs: ${docIds}`, {correlationId, docIds});
    const ret = {};
    for (const docId of docIds) {
        const o = await db.runTransaction(async (txn) => {
            const doc = coll.doc(docId);
            const scheduledImagination =
                (await txn.get(doc)).data()?.[SCHEDULED_IMAGINATION_FIELD]?.toDate();
            if (!(scheduledImagination && scheduledImagination <= refTime)) {
                log.log(`doc ID ${docId} scheduled imagination has already changed and so will be skipped`,
                    {correlationId, docId, scheduledImagination, refTime});
                return;
            }
            const out = await imaginationFn(docId);
            await txn.set(doc, {[SCHEDULED_IMAGINATION_FIELD]: firestore.FieldValue.delete()}, {merge: true});
            return out;
        });
        ret[docId] = o;
    }
    return ret;
});

export default {
    add,
    addImagination,
    addAction,
    getLatest,
    getHistory,
    getActions,
    getPinpoint,
    shortTermSearch,
    longTermSearch,
    consolidate,
    scheduleImagination,
    imagine,
};
