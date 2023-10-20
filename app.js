import express from 'express';
import * as uuid from 'uuid';
import 'dotenv/config';
import chat_ from './src/handler/chat.js';
import wrapper from './src/util/wrapper.js';

const app = express();
app.use(express.json());
app.use((req, res, next) => {
    const correlationId = req.headers['x-correlation-id'] || uuid.v4();
    req.correlationId = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);
    next();
});
app.get('/ping', async (req, res) => {
    await wrapper.logCorrelationId('/ping',
        async (_) => res.json({timestamp: new Date().toISOString()}))(req.correlationId);
});
app.post('/chat', async (req, res) => {
    await wrapper.logCorrelationId('/chat',
        async (correlationId) => {
            try {
                const ret = await chat_.chat(correlationId, req.body);
                res.json(ret);
            } catch (e) {
                res.status(500).json({error: e.message ?? '', stack: e.stack ?? ''});
            }
        })(req.correlationId);
});
app.listen(process.env.PORT);
