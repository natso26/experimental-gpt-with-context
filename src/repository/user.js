import firestore from '@google-cloud/firestore';
import wrapper from '../util/wrapper.js';

const TOP_LEVEL_COLLECTION = 'users';
const ROLE_FIELD = 'role';
const ROLES = {
    user: 'user',
    dev: 'dev',
};

const db = new firestore.Firestore();
const coll = db.collection(TOP_LEVEL_COLLECTION);

const getRole = wrapper.logCorrelationId('repository.user.getRole', async (correlationId, userId) => {
    const doc = coll.doc(userId);
    const rawRole = (await doc.get()).data()?.[ROLE_FIELD] || '';
    return !Object.values(ROLES).includes(rawRole) ? '' : rawRole;
});

export default {
    ROLES,
    getRole,
};
