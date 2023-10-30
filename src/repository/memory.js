import firestore from '@google-cloud/firestore';
import wrapper from '../util/wrapper.js';

const db = new firestore.Firestore();
const coll = db.collection('memory');

const add = wrapper.logCorrelationId('repository.memory.add', async (correlationId, chatId, elt) => {
    const eltsColl = coll.doc(chatId).collection('elts');
    const timestamp = new Date();
    return await db.runTransaction(async (txn) => {
        const snapshot = await txn.get(eltsColl.orderBy('index', 'desc').limit(1));
        const index = snapshot.empty ? 0 : snapshot.docs[0].data().index + 1;
        await txn.set(eltsColl.doc(), {
            index,
            timestamp,
            elt,
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
        const snapshot = await coll.doc(chatId).collection(`${lvl}-consolidations`)
            .orderBy('index', 'desc').limit(63).get();
        if (snapshot.empty) {
            continue;
        }
        const rawLvlData = snapshot.docs.map(doc => doc.data());
        const lvlData = rawLvlData.filter(({index}) => index > rawLvlData[rawLvlData.length - 1].index - 63);
        data.push(...lvlData);
    }
    return data.map(({consolidation}) => [consolidation, maximizingObjective(consolidation)])
        .sort((a, b) => b[1] - a[1])
        .slice(0, numResults);
});

const consolidate = wrapper.logCorrelationId('repository.memory.consolidate', async (correlationId, chatId, consolidationFn) => {
    for (let lvl = 0; lvl <= 9; lvl++) {
        const prevLvlColl = lvl ? await coll.doc(chatId).collection(`${lvl - 1}-consolidations`)
            : coll.doc(chatId).collection('elts');
        const lvlColl = coll.doc(chatId).collection(`${lvl}-consolidations`);
        const res = await db.runTransaction(async (txn) => {
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
            }
        });
        if (res === 'final-level') {
            break;
        }
    }
});

export default {add, getLatest, shortTermSearch, longTermSearch, consolidate};
