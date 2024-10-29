import express from 'express';

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Welcome to the Application');
});

app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    } else {
        return res.sendStatus(403);
    }
});

app.post('/webhook', (req, res) => {
    console.log('Received webhook event:', req.body);
    res.status(200).send('Webhook received');
});

export default app;
