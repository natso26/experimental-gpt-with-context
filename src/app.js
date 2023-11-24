import express from 'express';
import * as uuid from 'uuid';
import 'dotenv/config';
import query from './handler/query.js';
import history from './handler/history.js';
import consolidate from './handler/consolidate.js';
import introspect from './handler/introspect.js';
import imagine from './handler/imagine.js';
import research from './handler/research.js';
import common from './common.js';
import log from './util/log.js';
import wrapper from './util/wrapper.js';

const HTML_FILES_ROOT_PATH = './public';
const INDEX_HTML_FILE = 'index.html';
const HISTORY_HTML_FILE = 'history.html';

const internalApiAuthMiddleware = (req, res, next) => {
    const v = req.headers[common.INTERNAL_API_ACCESS_KEY_HEADER.toLowerCase()] || '';
    if (v !== process.env.INTERNAL_API_ACCESS_KEY) {
        log.log('there is an unauthorized attempt to access internal api', {v, path: req.path});
        res.status(500).json({error: ''});
        return;
    }
    next();
};

const correlationIdMiddleware = (req, res, next) => {
    const v = req.headers[common.CORRELATION_ID_HEADER.toLowerCase()] || uuid.v4();
    req.correlationId = v;
    res.setHeader(common.CORRELATION_ID_HEADER, v);
    next();
};

const wrapHandler = (name, handlerFn) => async (req, res) => {
    await wrapper.logCorrelationId(name, async (correlationId) => {
        try {
            const {body} = req;
            log.log(`${name} ${correlationId} request body`, {name, correlationId, body});
            const ret = await handlerFn(correlationId, body);
            log.log(`${name} ${correlationId} response body`, {name, correlationId, ret});
            res.json(ret);
        } catch (e) {
            const ret = {error: e.message ?? ''};
            log.log(`${name} ${correlationId} response error`, {name, correlationId, ...ret, stack: e.stack ?? ''});
            res.status(500).json(ret);
        }
    })(req.correlationId);
};

const indexHandler = async (req, res) => {
    log.log(`send ${INDEX_HTML_FILE}`);
    res.sendFile(INDEX_HTML_FILE, {root: HTML_FILES_ROOT_PATH});
};

const historyHandler = async (req, res) => {
    log.log(`send ${HISTORY_HTML_FILE}`);
    res.sendFile(HISTORY_HTML_FILE, {root: HTML_FILES_ROOT_PATH});
};

const pingInternalHandler = async (req, res) => {
    await wrapper.logCorrelationId(common.PING_INTERNAL_ROUTE,
        async (_) => res.json({timestamp: new Date().toISOString()}))(req.correlationId);
};

const app = express();
app.use(common.API_ROUTE_PREFIX, correlationIdMiddleware, express.json());
app.use(common.INTERNAL_ROUTE_PREFIX, internalApiAuthMiddleware, correlationIdMiddleware, express.json());
app.get(common.INDEX_ROUTE, indexHandler);
app.get(common.HISTORY_ROUTE, historyHandler);
app.post(common.QUERY_API_ROUTE, wrapHandler(common.QUERY_API_ROUTE, query.externalQuery));
app.post(common.HISTORY_API_ROUTE, wrapHandler(common.HISTORY_API_ROUTE, history.externalHistory));
app.get(common.PING_INTERNAL_ROUTE, pingInternalHandler);
app.post(common.QUERY_INTERNAL_ROUTE, wrapHandler(common.QUERY_INTERNAL_ROUTE, query.internalQuery));
app.post(common.CONSOLIDATE_INTERNAL_ROUTE, wrapHandler(common.CONSOLIDATE_INTERNAL_ROUTE, consolidate.internalConsolidate));
app.post(common.INTROSPECT_INTERNAL_ROUTE, wrapHandler(common.INTROSPECT_INTERNAL_ROUTE, introspect.internalIntrospect));
app.post(common.IMAGINE_INTERNAL_ROUTE, wrapHandler(common.IMAGINE_INTERNAL_ROUTE, imagine.internalImagine));
app.post(common.RESEARCH_INTERNAL_ROUTE, wrapHandler(common.RESEARCH_INTERNAL_ROUTE, research.internalResearch));
app.listen(process.env.PORT);
