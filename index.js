import express from 'express';
import dotenv from 'dotenv';

dotenv.config();  // Load environment variables

const app = express();
app.use(express.json()); // For JSON parsing

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
    console.log('Webhook event:', req.body);
    res.status(200).send('Webhook received');
});

// Export for Vercel Serverless
export default app;
