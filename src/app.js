import express from 'express';
import * as uuid from 'uuid';
import 'dotenv/config';
import chat from './handler/chat.js';
import consolidate from './handler/consolidate.js';
import introspect from './handler/introspect.js';
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
            const ret = await handlerFn(correlationId, req.body);
            res.json(ret);
        } catch (e) {
            res.status(500).json({error: e.message ?? '', stack: e.stack ?? ''});
        }
    })(req.correlationId);
};
app.post('/api/chat', wrapHandler('/api/chat', chat.chat));
app.post('/api/consolidate', wrapHandler('/api/consolidate', consolidate.consolidate));
app.post('/api/introspect', wrapHandler('/api/introspect', introspect.introspect));
app.listen(process.env.PORT);
