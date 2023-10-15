import express from 'express';
import 'dotenv/config';
import chat_ from './src/handler/chat.js';

const app = express();
app.use(express.json());
app.get('/ping', (req, res) => {
    res.json({timestamp: new Date().toISOString()});
});
app.post('/chat', chat_.chat);
app.listen(process.env.PORT);
