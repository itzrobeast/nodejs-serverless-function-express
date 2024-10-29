// index.js

import express from 'express';
import dotenv from 'dotenv';

dotenv.config();  // Load environment variables at the very beginning

const app = express();
app.use(express.json()); // Handles JSON payloads for POST requests

// Root route to check if app is running
app.get('/', (req, res) => {
    res.send('Welcome to the Application');
});

// Webhook route for verification and handling events
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
        console.log('Webhook verified');
        return res.status(200).send(challenge);
    } else {
        return res.sendStatus(403); // Forbidden if the token is incorrect
    }
});

app.post('/webhook', (req, res) => {
    console.log('Received webhook event:', req.body);
    res.status(200).send('Webhook received');
});

// Run the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

export default app;
