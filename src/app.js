import express from 'express';
import * as uuid from 'uuid';
import 'dotenv/config';
import query from './handler/query.js';
import history from './handler/history.js';
import consolidate from './handler/consolidate.js';
import introspect from './handler/introspect.js';
import imagine from './handler/imagine.js';
import common from './common.js';
import log from './util/log.js';
import wrapper from './util/wrapper.js';

const HTML_FILES_ROOT_PATH = './public';
const INDEX_HTML_FILE = 'index.html';
const HISTORY_HTML_FILE = 'history.html';

const correlationIdMiddleware = (req, res, next) => {
    const correlationId = req.headers['x-correlation-id'] || uuid.v4();
    req.correlationId = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);
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
            const errRet = {error: e.message ?? '', stack: e.stack ?? ''};
            log.log(`${name} ${correlationId} response error`, {name, correlationId, errRet});
            res.status(500).json(errRet);
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
app.get(common.INDEX_ROUTE, indexHandler);
app.get(common.HISTORY_ROUTE, historyHandler);
app.use(express.json());
app.use(correlationIdMiddleware);
app.post(common.QUERY_API_ROUTE, wrapHandler(common.QUERY_API_ROUTE, query.externalQuery));
app.post(common.HISTORY_API_ROUTE, wrapHandler(common.HISTORY_API_ROUTE, history.history));
app.get(common.PING_INTERNAL_ROUTE, pingInternalHandler);
app.post(common.QUERY_INTERNAL_ROUTE, wrapHandler(common.QUERY_INTERNAL_ROUTE, query.internalQuery));
app.post(common.CONSOLIDATE_INTERNAL_ROUTE, wrapHandler(common.CONSOLIDATE_INTERNAL_ROUTE, consolidate.consolidate));
app.post(common.INTROSPECT_INTERNAL_ROUTE, wrapHandler(common.INTROSPECT_INTERNAL_ROUTE, introspect.introspect));
app.post(common.IMAGINE_INTERNAL_ROUTE, wrapHandler(common.IMAGINE_INTERNAL_ROUTE, imagine.imagine));
app.listen(process.env.PORT);
