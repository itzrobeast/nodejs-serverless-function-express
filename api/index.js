import express from 'express';

const app = express();

app.get('/', (req, res) => {
    res.send('Hello, World!');
});

// Webhook endpoint
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.status(403).send('Forbidden');
    }
});

export default app;
