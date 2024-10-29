import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json()); // Middleware for parsing JSON

// Root route for testing server deployment
app.get('/', (req, res) => {
    res.send('Welcome to the Application');
});

// Webhook verification route for GET requests
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Verify token matches the environment variable
    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
        console.log('Webhook verified');
        return res.status(200).send(challenge);
    } else {
        console.log('Webhook verification failed');
        return res.sendStatus(403);
    }
});

// Endpoint for receiving POST webhook events
app.post('/webhook', (req, res) => {
    console.log('Received webhook event:', req.body);
    res.status(200).send('Webhook received');
});

export default app;
