import express from 'express';
import cors from 'cors';
import instagramWebhook from './instagram-webhook.js';

const app = express();

// Middleware configuration
app.use(express.json()); // Parses JSON request bodies
app.use(cors());         // Handles CORS headers

// Mount Instagram Webhook routes
app.use('/instagram-webhook', instagramWebhook);

// Root route for testing
app.get('/', (req, res) => {
  res.status(200).send('Server is working fine!');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Internal Server Error');
});

export default app;
