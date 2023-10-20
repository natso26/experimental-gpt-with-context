import firestore from '@google-cloud/firestore';
import wrapper from '../util/wrapper.js';

const coll = new firestore.Firestore().collection('memory');

const add = wrapper.logCorrelationId('repository.memory.add', async (correlationId, chatId, elt) => {
    const docRef = await coll.doc(chatId).collection('elts').add({
        timestamp: new Date(),
        elt,
    });
    return docRef.id;
});

const search = wrapper.logCorrelationId('repository.memory.search', async (correlationId, chatId, maximizingObjective, numResults) => {
    const snapshot = await coll.doc(chatId).collection('elts')
        .orderBy('timestamp', 'desc').limit(1000).get();
    const elts = snapshot.docs.map(doc => doc.data().elt).reverse();
    return elts.map((elt, i) => [elt, maximizingObjective(elt, i)])
        .sort((a, b) => b[1] - a[1])
        .slice(0, numResults);
});

export default {add, search};
