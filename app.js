import express from 'express';
import 'dotenv/config'

const app = express();
app.use(express.json());
app.get('/ping', (req, res) => {
    res.json({timestamp: new Date().toISOString()});
});
app.listen(process.env.PORT);
