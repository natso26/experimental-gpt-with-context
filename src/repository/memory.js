import firestore from '@google-cloud/firestore';
import log from '../util/log.js';
import wrapper from '../util/wrapper.js';

const db = new firestore.Firestore();
const coll = db.collection('memory');

const add = wrapper.logCorrelationId('repository.memory.add', async (correlationId, chatId, elt, isInternal) => {
    const eltsColl = coll.doc(chatId).collection('elts');
    const timestamp = new Date();
    return await db.runTransaction(async (txn) => {
        const snapshot = await txn.get(eltsColl.orderBy('index', 'desc').limit(1));
        const index = snapshot.empty ? 0 : snapshot.docs[0].data().index + 1;
        await txn.set(eltsColl.doc(), {
            index,
            timestamp,
            isInternal,
            elt,
        });
        return index;
    });
});

const addImagination = wrapper.logCorrelationId('repository.memory.addImagination', async (correlationId, chatId, consolidation) => {
    const imaginationsColl = coll.doc(chatId).collection('imaginations');
    const timestamp = new Date();
    return await db.runTransaction(async (txn) => {
        const snapshot = await txn.get(imaginationsColl.orderBy('index', 'desc').limit(1));
        const index = snapshot.empty ? 0 : snapshot.docs[0].data().index + 1;
        await txn.set(imaginationsColl.doc(), {
            index,
            timestamp,
            consolidation,
        });
        return index;
    });
});

const getLatest = wrapper.logCorrelationId('repository.memory.getLatest', async (correlationId, chatId, numResults) => {
    const snapshot = await coll.doc(chatId).collection('elts')
        .orderBy('index', 'desc').limit(numResults).get();
    const data = snapshot.docs.map(doc => doc.data());
    return [data.map(({elt}) => elt).reverse(), data.empty ? -1 : data[0].index];
});

const getHistory = wrapper.logCorrelationId('repository.memory.getHistory', async (correlationId, chatId, offset, limit) => {
    const snapshot = await coll.doc(chatId).collection('elts')
        .where('isInternal', '!=', true).orderBy('isInternal')
        .orderBy('index', 'desc').offset(offset).limit(limit).get();
    const data = snapshot.docs.map(doc => doc.data());
    return data.map(({elt}) => elt).reverse();
});

const shortTermSearch = wrapper.logCorrelationId('repository.memory.shortTermSearch', async (correlationId, chatId, maximizingObjective, numResults) => {
    const snapshot = await coll.doc(chatId).collection('elts')
        .orderBy('index', 'desc').limit(1000).get();
    const data = snapshot.docs.map(doc => doc.data());
    return data.map(({timestamp, elt}, i) => [elt, maximizingObjective(elt, i, timestamp.toDate())])
        .sort((a, b) => b[1] - a[1])
        .slice(0, numResults);
});

const longTermSearch = wrapper.logCorrelationId('repository.memory.longTermSearch', async (correlationId, chatId, maximizingObjective, numResults) => {
    const data = [];
    for (let lvl = 0; lvl <= 9; lvl++) {
        const snapshot = await coll.doc(chatId).collection(
            lvl < 9 ? `${lvl}-consolidations` : 'imaginations')
            .orderBy('index', 'desc').limit(63).get();
        if (snapshot.empty) {
            continue;
        }
        const rawLvlData = snapshot.docs.map(doc => doc.data());
        const lvlData = rawLvlData.filter(({index}) => index > rawLvlData[rawLvlData.length - 1].index - 63);
        data.push(...lvlData);
    }
    const getConsolidations = () => data.map(({consolidation}) => consolidation);
    return data.map(({consolidation}) => [consolidation, maximizingObjective(getConsolidations, consolidation)])
        .sort((a, b) => b[1] - a[1])
        .slice(0, numResults);
});

const consolidate = wrapper.logCorrelationId('repository.memory.consolidate', async (correlationId, chatId, consolidationFn) => {
    const ret = [];
    for (let lvl = 0; lvl <= 8; lvl++) {
        const prevLvlColl = lvl ? await coll.doc(chatId).collection(`${lvl - 1}-consolidations`)
            : coll.doc(chatId).collection('elts');
        const lvlColl = coll.doc(chatId).collection(`${lvl}-consolidations`);
        const txnRes = await db.runTransaction(async (txn) => {
            const s = await txn.get(prevLvlColl.orderBy('index', 'desc').limit(1));
            const latestPrevLvlIndex = s.empty ? -1 : s.docs[0].data().index;
            const s2 = await txn.get(lvlColl.orderBy('index', 'desc').limit(1));
            const latestLvlIndex = s2.empty ? -1 : s2.docs[0].data().index;
            const targetLvlIndex = lvl ? Math.floor((latestPrevLvlIndex - 3) / 4)
                : Math.floor((latestPrevLvlIndex - 7) / 4);
            if (targetLvlIndex < 0) {
                return 'final-level';
            }
            if (targetLvlIndex <= latestLvlIndex) {
                return;
            }
            const prevLvlSnapshot = await txn.get(prevLvlColl.orderBy('index', 'desc')
                .offset((latestPrevLvlIndex + 1) % 4)
                .limit(4 * (targetLvlIndex - latestLvlIndex + !lvl)));
            const prevLvlData = prevLvlSnapshot.docs
                .map(doc => doc.data()).reverse();
            for (let i = latestLvlIndex + 1; i <= targetLvlIndex; i++) {
                const raw = prevLvlData.slice(4 * (i - latestLvlIndex - 1), 4 * (i - latestLvlIndex + !lvl));
                const consolidation = await consolidationFn(lvl,
                    lvl ? raw.map(({consolidation}) => consolidation) : raw.map(({elt}) => elt));
                await txn.set(lvlColl.doc(), {
                    index: i,
                    consolidation,
                });
                ret.push({lvl, index: i, consolidation});
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
        const curr = s.data()?.scheduledImagination?.toDate() || null;
        const scheduledImagination = getNext(curr);
        if (scheduledImagination !== curr) {
            await txn.set(doc,
                {scheduledImagination: scheduledImagination || firestore.FieldValue.delete()}, {merge: true});
        }
        return scheduledImagination;
    });
});

const imagine = wrapper.logCorrelationId('repository.memory.imagine', async (correlationId, refTime, imaginationFn) => {
    const s = await coll.where('scheduledImagination', '<=', firestore.Timestamp.fromDate(refTime))
        .orderBy('scheduledImagination').get();
    const chatIds = s.docs.map(doc => doc.id);
    log.log(`imagine for chat IDs: ${chatIds}`, {correlationId, chatIds});
    const ret = {};
    for (const chatId of chatIds) {
        const out = await db.runTransaction(async (txn) => {
            const doc = coll.doc(chatId);
            const scheduledImagination = (await txn.get(doc)).data()?.scheduledImagination?.toDate();
            if (!(scheduledImagination && scheduledImagination <= refTime)) {
                log.log(`chat ID ${chatId} scheduled imagination has already changed and so will be skipped`,
                    {correlationId, chatId, scheduledImagination, refTime});
                return;
            }
            const out = await imaginationFn(chatId);
            await txn.set(doc, {scheduledImagination: firestore.FieldValue.delete()}, {merge: true});
            return out;
        });
        ret[chatId] = out;
    }
    return ret;
});

export default {
    add, addImagination, getLatest, getHistory, shortTermSearch, longTermSearch,
    consolidate, scheduleImagination, imagine,
};
