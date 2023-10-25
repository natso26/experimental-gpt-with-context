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
    const eltsRef = await coll.doc(chatId).collection('elts');
    const snapshot = await eltsRef.orderBy('index', 'desc').limit(1).get();
    const latestIndex = snapshot.empty ? -1 : snapshot.docs[0].data().index;
    if (latestIndex < 7) {
        return;
    }
    const consolidationsRef = await coll.doc(chatId).collection('consolidations');
    let consolidationLevel = 0;
    while (true) {
        let targetConsolidationIndex = Math.floor((latestIndex - 7) / 4);
        for (let i = 0; i < consolidationLevel; i++) {
            targetConsolidationIndex = Math.floor((targetConsolidationIndex + 1) / 4) - 1;
        }
        if (targetConsolidationIndex < 0) {
            break;
        }
        await db.runTransaction(async (txn) => {
            const snapshot = await consolidationsRef.orderBy('index', 'desc').limit(1).get();

        });
        const latestConsolidationIndex = snapshot.empty ? -1 : snapshot.docs[0].data().index;
        if (targetConsolidationIndex <= latestConsolidationIndex) {
            return;
        }
        for (let i = latestConsolidationIndex + 1; i <= targetConsolidationIndex; i++) {
            const consolidationRef = consolidationsRef.doc();
            await db.runTransaction(async (txn) => {
                const snapshot = await txn.get(eltsRef.orderBy('index', 'desc')
                    .offset(i * 4).limit(4));
                const elts = snapshot.docs.map(doc => doc.data().elt);
                await txn.set(consolidationRef, {
                    index: i,
                    elts,
                });
            });
        }
        consolidationLevel++;
    }
});

export default {add, search};
