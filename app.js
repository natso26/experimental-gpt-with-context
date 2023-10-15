import express from 'express';
import 'dotenv/config';
import {chat} from './src/chat.js';

const app = express();
app.use(express.json());
app.get('/ping', (req, res) => {
    res.json({timestamp: new Date().toISOString()});
});
app.post('/chat', async (req, res) => {
    const messages = req.body.messages;
    const data = await chat(messages);
    res.json(data);
});
app.listen(process.env.PORT);
