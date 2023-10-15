import chat_ from '../service/chat.js';

const chat = async (req, res) => {
    const message = req.body.message;
    const data = await chat_.chat(message);
    res.json(data);
}

export default {chat};
