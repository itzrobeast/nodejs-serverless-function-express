import express from 'express';

const app = express();
app.use(express.json()); // To handle JSON payloads from POST requests

// Define the GET route for verification purposes
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

// Define the POST route to handle incoming webhook events
app.post('/webhook', (req, res) => {
    console.log('Received webhook event:', req.body);
    // Add logic to handle the event data as needed
    res.status(200).send('Webhook received');
});

export default app;
