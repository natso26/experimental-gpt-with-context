import firestore from '@google-cloud/firestore';
import wrapper from '../util/wrapper.js';

const db = new firestore.Firestore();
const coll = db.collection('memory');

const add = wrapper.logCorrelationId('repository.memory.add', async (correlationId, chatId, elt) => {
    const eltsRef = coll.doc(chatId).collection('elts');
    const timestamp = new Date();
    return await db.runTransaction(async (txn) => {
        const snapshot = await txn.get(eltsRef.orderBy('index', 'desc').limit(1));
        const index = snapshot.empty ? 0 : snapshot.docs[0].data().index + 1;
        const docRef = eltsRef.doc();
        await txn.set(docRef, {
            index,
            timestamp,
            elt,
        });
        return docRef.id;
    });
});

const search = wrapper.logCorrelationId('repository.memory.search', async (correlationId, chatId, maximizingObjective, numResults) => {
    const snapshot = await coll.doc(chatId).collection('elts')
        .orderBy('index', 'desc').limit(1000).get();
    const data = snapshot.docs.map(doc => doc.data());
    return data.map(({timestamp, elt}, i) => [elt, maximizingObjective(elt, i, timestamp.toDate())])
        .sort((a, b) => b[1] - a[1])
        .slice(0, numResults);
});

const consolidate = wrapper.logCorrelationId('repository.memory.consolidate', async (correlationId, chatId, consolidationFn) => {
    let lvl = 0;
    while (true) {
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
                .limit(4 * (targetLvlIndex - latestLvlIndex + !lvl)));
            const prevLvlData = prevLvlSnapshot.docs
                .map(doc => doc.data()).reverse();
            for (let i = latestLvlIndex + 1; i <= targetLvlIndex; i++) {
                const raw = prevLvlData.slice(4 * (i - latestLvlIndex - 1), 4 * (i - latestLvlIndex + !lvl));
                const summary = await consolidationFn(lvl,
                    lvl ? raw.map(({summary}) => summary) : raw.map(({elt}) => elt));
                await txn.set(lvlColl.doc(), {
                    index: i,
                    summary,
                });
            }
        });
        if (res === 'final-level') {
            break;
        }
        lvl++;
    }
});

export default {add, search, consolidate};
