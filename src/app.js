import * as fs from 'fs';
import express from 'express';
import * as uuid from 'uuid';
import 'dotenv/config';
import query from './handler/query.js';
import details from './handler/details.js';
import history from './handler/history.js';
import consolidate from './handler/consolidate.js';
import introspect from './handler/introspect.js';
import imagine from './handler/imagine.js';
import research from './handler/research.js';
import uule from './service/support/uule.js';
import common from './common.js';
import strictParse from './util/strictParse.js';
import log from './util/log.js';
import cache from './util/cache.js';
import wrapper from './util/wrapper.js';
import time from './util/time.js';
import error from './util/error.js';

const INDEX_HTML_PATH = './public/index.html';
const PAGES = {
    query: 'query',
    details: 'details',
    history: 'history',
};
const VERSION = process.env.VERSION;
const _OVERRIDE_IP = process.env.OVERRIDE_IP;
(process.env.ENV === 'local' || !_OVERRIDE_IP) || (() => {
    throw new Error('OVERRIDE_IP not correctly set');
})();
const SSE_KEEPALIVE_INTERVAL = strictParse.int(process.env.APP_SSE_KEEPALIVE_INTERVAL_SECS) * time.SECOND;
const RENDER_INDEX_HTML = wrapper.cache(
    cache.lruTtl(10, 15 * time.MINUTE), ({page, version}) => `${version}-${page}`, async ({page, version}) => {
        const s = await fs.promises.readFile(INDEX_HTML_PATH, {encoding: 'utf-8'});
        return s.replace('{{ PAGE }}', page)
            .replace('{{ VERSION }}', version);
    });

const init = async () => {
    await uule.init();
};

const initMiddleware = (() => {
    let hasInited = false;
    return common.asyncMiddleware(async (req, res, next) => {
        if (!hasInited) {
            hasInited = true;
            await init().catch((_) => '');
        }
        next();
    });
})();

const versionMiddleware = (req, res, next) => {
    res.setHeader('X-App-Version', VERSION);
    next();
};

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

const ipMiddleware = (req, res, next) => {
    const ip = _OVERRIDE_IP || req.ip;
    log.log(`request ip: ${ip}`, {correlationId: req.correlationId, ip});
    req.body.ip = ip;
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
            const ex = error.explain(e);
            log.log(`${name} ${correlationId} response error`, {name, correlationId, ...ex});
            res.status(500).json({error: ex.error});
        }
    })(req.correlationId);
};

const wrapHandlerSse = (name, handlerFn) => async (req, res) => {
    const doWrite = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    await wrapper.logCorrelationId(name, async (correlationId) => {
        let intervalId;
        try {
            const {body} = req;
            log.log(`${name} ${correlationId} request body`, {name, correlationId, body});
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });
            const onPartial = (partial) => doWrite({state: 'partial', data: partial});
            // NB: counteract buffering
            intervalId = setInterval(() => doWrite({state: 'keepalive', data: {}}), SSE_KEEPALIVE_INTERVAL);
            const ret = await handlerFn(correlationId, onPartial, body);
            log.log(`${name} ${correlationId} response body`, {name, correlationId, ret});
            doWrite({state: 'success', data: ret});
        } catch (e) {
            const ex = error.explain(e);
            log.log(`${name} ${correlationId} response error`, {name, correlationId, ...ex});
            doWrite({state: 'error', data: {error: ex.error}});
        } finally {
            if (intervalId) {
                clearInterval(intervalId);
            }
            res.end();
        }
    })(req.correlationId);
};

const pageHandler = (page) => async (req, res) => {
    const params = {page, version: VERSION};
    log.log(`render ${INDEX_HTML_PATH}, params ${JSON.stringify(params)}`, {params});
    const content = await RENDER_INDEX_HTML(params);
    res.setHeader('Content-Type', 'text/html');
    res.send(content);
};
const indexHandler = pageHandler(PAGES.query);
const detailsHandler = pageHandler(PAGES.details);
const historyHandler = pageHandler(PAGES.history);

const pingInternalHandler = async (req, res) => {
    await wrapper.logCorrelationId(common.PING_INTERNAL_ROUTE,
        async (_) => res.json({timestamp: new Date().toISOString()}))(req.correlationId);
};

const app = express();
app.set('trust proxy', true);
app.use('/favicon.ico', express.static('./public/favicon.ico'));
app.use(versionMiddleware);
app.use(common.API_ROUTE_PREFIX, correlationIdMiddleware, express.json());
app.use(common.INTERNAL_ROUTE_PREFIX, internalApiAuthMiddleware, correlationIdMiddleware, express.json());
app.get(common.INDEX_ROUTE, initMiddleware, indexHandler);
app.get(common.DETAILS_ROUTE, initMiddleware, detailsHandler);
app.get(common.HISTORY_ROUTE, initMiddleware, historyHandler);
app.post(common.QUERY_API_ROUTE, ipMiddleware, wrapHandlerSse(common.QUERY_API_ROUTE, query.externalQuery));
app.post(common.DETAILS_API_ROUTE, wrapHandler(common.DETAILS_API_ROUTE, details.externalDetails));
app.post(common.HISTORY_API_ROUTE, wrapHandler(common.HISTORY_API_ROUTE, history.externalHistory));
app.get(common.PING_INTERNAL_ROUTE, pingInternalHandler);
app.post(common.QUERY_INTERNAL_ROUTE, wrapHandler(common.QUERY_INTERNAL_ROUTE, query.internalQuery));
app.post(common.CONSOLIDATE_INTERNAL_ROUTE, wrapHandler(common.CONSOLIDATE_INTERNAL_ROUTE, consolidate.internalConsolidate));
app.post(common.INTROSPECT_INTERNAL_ROUTE, wrapHandler(common.INTROSPECT_INTERNAL_ROUTE, introspect.internalIntrospect));
app.post(common.IMAGINE_INTERNAL_ROUTE, wrapHandler(common.IMAGINE_INTERNAL_ROUTE, imagine.internalImagine));
app.post(common.RESEARCH_INTERNAL_ROUTE, wrapHandler(common.RESEARCH_INTERNAL_ROUTE, research.internalResearch));
app.listen(process.env.PORT);
