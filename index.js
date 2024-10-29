import express from 'express';

const app = express();
app.use(express.json()); // Middleware to parse JSON payloads

// Root route for quick testing
app.get('/', (req, res) => {
    res.send('Welcome to the Application');
});

// Webhook route to handle GET for verification and POST for events
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
        console.log('Webhook verified');
        return res.status(200).send(challenge);
    } else {
        console.log('Webhook verification failed');
        return res.sendStatus(403); // Forbidden if token doesn't match
    }
});

app.post('/webhook', (req, res) => {
    // Log the incoming event for debugging
    console.log('Received webhook event:', req.body);
    
    // Acknowledge receipt of the webhook event
    res.status(200).send('Webhook received');
});

export default app;
