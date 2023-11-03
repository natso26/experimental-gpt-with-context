import express from 'express';
import * as uuid from 'uuid';
import 'dotenv/config';
import chat from './handler/chat.js';
import consolidate from './handler/consolidate.js';
import introspect from './handler/introspect.js';
import imagine from './handler/imagine.js';
import history from './handler/history.js';
import log from './util/log.js';
import wrapper from './util/wrapper.js';

const app = express();
app.get('/', (req, res) => {
    log.log('send index.html');
    res.sendFile('index.html', {root: './public'});
});
app.get('/history', (req, res) => {
    log.log('send history.html');
    res.sendFile('history.html', {root: './public'});
});
app.use(express.json());
app.use((req, res, next) => {
    const correlationId = req.headers['x-correlation-id'] || uuid.v4();
    req.correlationId = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);
    next();
});
app.get('/api/ping', async (req, res) => {
    await wrapper.logCorrelationId('/api/ping',
        async (_) => res.json({timestamp: new Date().toISOString()}))(req.correlationId);
});
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
app.post('/api/chat', wrapHandler('/api/chat', chat.chat));
app.post('/api/consolidate', wrapHandler('/api/consolidate', consolidate.consolidate));
app.post('/api/introspect', wrapHandler('/api/introspect', introspect.introspect));
app.post('/api/imagine', wrapHandler('/api/imagine', imagine.imagine));
app.post('/api/history', wrapHandler('/api/history', history.history));
app.listen(process.env.PORT);
