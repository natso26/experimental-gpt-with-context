import yaml from 'yaml';
import memory from '../../repository/db/memory.js';
import common from '../common.js';
import log from '../../util/log.js';
import wrapper from '../../util/wrapper.js';

const ACTIONS_KEY = 'actions';
const TIMESTAMP_KEY = 'timestamp';

const getDetails = wrapper.logCorrelationId('service.support.details.getDetails', async (correlationId, userId, sessionId, item) => {
    log.log('getDetails: parameters', {correlationId, userId, sessionId, item});
    const docId = common.DOC_ID.from(userId, sessionId);
    const elt = await memory.getPinpoint(correlationId, docId, {type: 'elt', offset: item});
    if (!elt) {
        throw new Error(`not found item: ${item}`);
    }
    const full = await expandActions(correlationId, docId, formatDoc(elt));
    delete full[common.QUERY_EMBEDDING_FIELD];
    delete full[common.REPLY_EMBEDDING_FIELD];
    const overview = getOverview(full);
    const overviewYaml = yaml.stringify(overview, {lineWidth: 0, indent: 1, singleQuote: true});
    return {
        overviewYaml,
        overview,
        full,
    };
});

const expandActions = async (correlationId, docId, data) => {
    const actions = data[ACTIONS_KEY]?.flatMap((el) => {
        const {v} = el;
        return Array.isArray(v) ? v : [el];
    }) || [];
    for (const action of actions) {
        const {index} = action;
        if (index === undefined) {
            continue;
        }
        const actionElt = await memory.getPinpoint(correlationId, docId, {type: 'action', index});
        if (!actionElt) {
            log.log(`getDetails: expand actions: not found action, index: ${index}`, {correlationId, docId, index});
        } else {
            Object.assign(action, await expandActions(correlationId, docId, formatDoc(actionElt)));
        }
    }
    return data;
};

const getOverview = (data) => {
    const {timestamp, url, kind, query, reply, actions} = data;
    const actionOverviews_ = actions?.map((el) => {
        const {v} = el;
        return Array.isArray(v) ? v.map(getOverview) : getOverview(el);
    });
    const actionOverviews = !actionOverviews_ ? undefined : {...actionOverviews_};
    return {timestamp, url, kind, query, reply, actions: actionOverviews};
};

const formatDoc = (doc) => {
    const {index, timestamp, lvl, elt, extra} = doc;
    return {index, timestamp: timestamp.toDate(), lvl, ...elt, ...cleanObj(extra)};
};

const cleanObj = (o) => Object.fromEntries(Object.entries(o)
    .sort(([k1,], [k2,]) =>
        k1 === ACTIONS_KEY ? 1 : k2 === ACTIONS_KEY ? -1 : k1.localeCompare(k2))
    .map(([k, v]) =>
        (k === TIMESTAMP_KEY && v.toDate) ? [k, v.toDate()] : [k, v]) // firestore timestamp
    .map(([k, v]) =>
        [k, Array.isArray(v) ? v.map((v) => isObj(v) ? cleanObj(v) : v) :
            isObj(v) ? cleanObj(v) : v]));

const isObj = (v) => v !== null && !Array.isArray(v) && !(v instanceof Date) && typeof v === 'object';

export default {
    getDetails,
};
