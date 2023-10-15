import express from "express";

const app = express();
app.use(express.json());
app.get('/ping', (req, res) => {
    res.json({timestamp: new Date().toISOString()});
});
app.listen(3000);
