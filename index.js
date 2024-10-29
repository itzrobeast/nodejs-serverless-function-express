import express from 'express';

const app = express();

// Main route
app.get('/', (req, res) => {
    res.send('Welcome to the application!');
});

// Other routes (e.g., /webhook or /api/some-route)
app.post('/webhook', (req, res) => {
    // Handle webhook events
    res.send('Webhook received');
});

export default app;
