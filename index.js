// index.js or app.js
import express from 'express';

const app = express();
app.use(express.json()); // This handles JSON payloads for POST requests

// Define the root route to display a welcome message
app.get('/', (req, res) => {
    res.send('Welcome to the Application');
});

// Existing webhook route for verification (GET) and handling events (POST)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
        console.log('Webhook verified');
        return res.status(200).send(challenge);
    } else {
        return res.sendStatus(403); // Forbidden if the verification token is incorrect
    }
});

app.post('/webhook', (req, res) => {
    console.log('Received webhook event:', req.body);
    res.status(200).send('Webhook received');
});

export default app;
