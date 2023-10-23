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

export default {add, search};
